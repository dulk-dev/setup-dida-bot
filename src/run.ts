import type { AppConfig } from "./config.ts";
import {
  DidaApiError,
  DidaCliClient,
  type CreateTagInput,
  type DidaApi,
  type DidaTask,
} from "./dida-api.ts";
import {
  withBotLifecycleTag,
  withFreezeTag,
  type Markers,
} from "./markers.ts";
import {
  appendFragmentContent,
  chooseMergeMain,
  contentAlreadyHasPayload,
  createdTimeSecond,
  isBotFragment,
  isTodoClaimCandidate,
  planFragmentActions,
  rewriteBotTitleToNot,
  shouldSkipAutoMerge,
  type DepMerge,
  type MergeTask,
  type SkipReason,
} from "./merge-logic.ts";
import {
  acquireMergeLock,
  isFragmentProcessed,
  markFragmentProcessed,
  releaseMergeLock,
  writeStatus,
  type RunStatus,
} from "./store.ts";
import {
  postWebhook,
  type MergeSummaryItem,
  type PendingBotItem,
} from "./webhook.ts";

export interface MergeRunResult {
  ok: boolean;
  locked?: boolean;
  error?: string;
  searched: number;
  inbox: number;
  pool: number;
  fragments: number;
  mergedCount: number;
  notted: number;
  claimed: number;
  skipped: Array<{ fragmentId: string; reason: SkipReason | string }>;
  merges: MergeSummaryItem[];
  nots: Array<{ fragmentId: string; title: string }>;
  pending: PendingBotItem[];
  webhook?: { work?: number };
  durationMs?: number;
}

function emptyResult(
  extra: Partial<MergeRunResult> & Pick<MergeRunResult, "ok">,
): MergeRunResult {
  return {
    searched: 0,
    inbox: 0,
    pool: 0,
    fragments: 0,
    mergedCount: 0,
    notted: 0,
    claimed: 0,
    skipped: [],
    merges: [],
    nots: [],
    pending: [],
    ...extra,
  };
}

function toMergeTask(task: DidaTask): MergeTask | null {
  if (!task.id || !task.projectId) return null;
  const status = task.status ?? 0;
  if (status !== 0) return null;
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title ?? "",
    content: task.content ?? "",
    createdTime: task.createdTime ?? undefined,
    status,
    tags: task.tags,
  };
}

function needsDetail(task: DidaTask): boolean {
  return !task.createdTime || !task.projectId;
}

function unionTasks(search: DidaTask[], inbox: DidaTask[]): DidaTask[] {
  const map = new Map<string, DidaTask>();
  for (const task of [...search, ...inbox]) {
    const existing = map.get(task.id);
    if (!existing) {
      map.set(task.id, task);
      continue;
    }
    map.set(task.id, {
      ...existing,
      ...task,
      title: task.title ?? existing.title,
      content: task.content ?? existing.content,
      createdTime: task.createdTime ?? existing.createdTime,
      projectId: task.projectId || existing.projectId,
      tags: task.tags ?? existing.tags,
    });
  }
  return [...map.values()];
}

async function hydrateMissing(
  api: DidaApi,
  tasks: DidaTask[],
  skipped: MergeRunResult["skipped"],
  maxHydrate: number,
): Promise<DidaTask[]> {
  const out: DidaTask[] = [];
  let hydrates = 0;
  for (const task of tasks) {
    if (!needsDetail(task) || !task.projectId) {
      out.push(task);
      continue;
    }
    if (hydrates >= maxHydrate) {
      out.push(task);
      continue;
    }
    hydrates += 1;
    try {
      const detail = await api.getTask(task.projectId, task.id);
      out.push({
        ...task,
        ...detail,
        title: detail.title ?? task.title,
        content: detail.content ?? task.content,
        createdTime: detail.createdTime ?? task.createdTime,
        projectId: detail.projectId || task.projectId,
        tags: detail.tags ?? task.tags,
      });
    } catch (error) {
      skipped.push({
        fragmentId: task.id,
        reason: `hydrate_failed:${error instanceof Error ? error.message : "unknown"}`,
      });
      out.push(task);
    }
  }
  return out;
}

async function executeNotRewrite(
  api: DidaApi,
  fragment: MergeTask,
  m: Markers,
): Promise<
  | { ok: true; not: { fragmentId: string; title: string } }
  | { ok: false; reason: string }
> {
  const nextTitle = rewriteBotTitleToNot(fragment.title, m);
  const nextTags = withFreezeTag(m, fragment.tags);
  const titleChanged = nextTitle !== fragment.title;
  const tagsChanged =
    JSON.stringify(fragment.tags ?? []) !== JSON.stringify(nextTags);
  if (!titleChanged && !tagsChanged) {
    return { ok: false, reason: "not_rewrite_noop" };
  }
  try {
    await api.updateTask(fragment.id, fragment.projectId, {
      ...(titleChanged ? { title: nextTitle } : {}),
      ...(tagsChanged ? { tags: nextTags } : {}),
    });
    return { ok: true, not: { fragmentId: fragment.id, title: nextTitle } };
  } catch (error) {
    return {
      ok: false,
      reason: `not_error:${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

async function executeMerge(
  api: DidaApi,
  dataDir: string,
  pair: DepMerge,
  m: Markers,
): Promise<
  | { ok: true; merge: MergeSummaryItem }
  | { ok: false; reason: string }
> {
  const choice = chooseMergeMain(pair.fragment, pair.dep);
  try {
    let main: MergeTask = choice.main;
    if (choice.deleteFragment) {
      const detail = await api.getTask(pair.dep.projectId, pair.dep.id);
      main = {
        ...pair.dep,
        content: detail.content ?? pair.dep.content,
        title: detail.title ?? pair.dep.title,
        createdTime: detail.createdTime ?? pair.dep.createdTime,
        projectId: detail.projectId || pair.dep.projectId,
        tags: detail.tags ?? pair.dep.tags,
      };
    }

    const { content: nextContent } = appendFragmentContent(
      main.content,
      choice.payload,
      m.appendSeparator,
    );
    const nextTags = withBotLifecycleTag(m, main.tags, m.tagTodo);
    const needContent = !contentAlreadyHasPayload(
      main.content,
      choice.payload,
      m.appendSeparator,
    );
    const needTags =
      JSON.stringify(main.tags ?? []) !== JSON.stringify(nextTags);
    if (needContent || needTags) {
      await api.updateTask(main.id, main.projectId, {
        content: nextContent,
        tags: nextTags,
      });
    }

    const readback = await api.getTask(main.projectId, main.id);
    const readContent = readback.content ?? "";
    if (
      !contentAlreadyHasPayload(readContent, choice.payload, m.appendSeparator) &&
      !readContent.includes(choice.payload)
    ) {
      return { ok: false, reason: "verify_failed" };
    }

    if (choice.deleteFragment) {
      await api.deleteTask(pair.fragment.projectId, pair.fragment.id);
    }
    markFragmentProcessed(dataDir, pair.fragment.id);

    return {
      ok: true,
      merge: {
        fragmentId: pair.fragment.id,
        contextId: main.id,
        fragmentTitle: pair.fragment.title,
        contextTitle: main.title,
        createdSecond:
          createdTimeSecond(pair.fragment.createdTime) ??
          pair.fragment.createdTime ??
          "",
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: `merge_error:${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

export async function mergeFragments(
  api: DidaApi,
  dataDir: string,
  tasks: MergeTask[],
  m: Markers,
  maxMergeOrNot: number,
): Promise<{
  merges: MergeSummaryItem[];
  nots: Array<{ fragmentId: string; title: string }>;
  skipped: MergeRunResult["skipped"];
}> {
  const skipped: MergeRunResult["skipped"] = [];
  const eligible: MergeTask[] = [];

  for (const task of tasks) {
    if (!isBotFragment(task, m)) {
      eligible.push(task);
      continue;
    }
    if (shouldSkipAutoMerge(task, m)) {
      continue;
    }
    if (isFragmentProcessed(dataDir, task.id)) {
      skipped.push({ fragmentId: task.id, reason: "already_processed" });
      continue;
    }
    eligible.push(task);
  }

  const planned = planFragmentActions(eligible, m);
  for (const item of planned.skipped) {
    skipped.push({ fragmentId: item.fragment.id, reason: item.reason });
  }

  const actions: Array<
    | { kind: "merge"; merge: DepMerge }
    | { kind: "not"; fragment: MergeTask }
  > = [];
  for (const merge of planned.merges) {
    actions.push({ kind: "merge", merge });
  }
  for (const fragment of planned.nots) {
    actions.push({ kind: "not", fragment });
  }
  actions.sort((a, b) => {
    const aTask = a.kind === "merge" ? a.merge.fragment : a.fragment;
    const bTask = b.kind === "merge" ? b.merge.fragment : b.fragment;
    const at = aTask.createdTime ?? "";
    const bt = bTask.createdTime ?? "";
    if (at !== bt) return at.localeCompare(bt);
    return aTask.id.localeCompare(bTask.id);
  });

  const merges: MergeSummaryItem[] = [];
  const nots: Array<{ fragmentId: string; title: string }> = [];
  let acted = 0;

  for (const action of actions) {
    if (acted >= maxMergeOrNot) break;
    if (action.kind === "merge") {
      const result = await executeMerge(api, dataDir, action.merge, m);
      if (result.ok) {
        merges.push(result.merge);
        acted += 1;
      } else {
        skipped.push({
          fragmentId: action.merge.fragment.id,
          reason: result.reason,
        });
      }
      continue;
    }

    const rewritten = await executeNotRewrite(api, action.fragment, m);
    if (rewritten.ok) {
      nots.push(rewritten.not);
      acted += 1;
    } else {
      skipped.push({
        fragmentId: action.fragment.id,
        reason: rewritten.reason,
      });
    }
  }

  return { merges, nots, skipped };
}

async function createTagIfMissing(
  api: DidaApi,
  tag: CreateTagInput,
): Promise<void> {
  try {
    await api.createTag(tag);
  } catch (error) {
    if (
      error instanceof DidaApiError &&
      (error.status === 400 || error.status === 409)
    ) {
      console.log(
        JSON.stringify({
          msg: "dida_create_tag_exists",
          name: tag.name,
          status: error.status,
        }),
      );
      return;
    }
    throw error;
  }
}

/** Ensure parent + nested lifecycle/freeze leaves exist. */
export async function ensureBotTags(
  api: DidaApi,
  m: Markers,
): Promise<void> {
  const existing = await api.listTags();
  const names = new Set(existing.map((tag) => tag.name));
  if (m.ensureParentTag && !names.has(m.tagParent)) {
    await createTagIfMissing(api, {
      name: m.tagParent,
      label: m.tagParent,
    });
    names.add(m.tagParent);
  }
  for (const leaf of m.nestedTags) {
    if (names.has(leaf)) continue;
    await createTagIfMissing(api, {
      name: leaf,
      label: leaf,
      ...(m.ensureParentTag ? { parent: m.tagParent } : {}),
    });
    names.add(leaf);
  }
}

async function resolveTaskTags(
  api: DidaApi,
  task: { id: string; projectId: string; tags?: string[] },
): Promise<{ tags: string[]; projectId: string } | null> {
  if (task.tags !== undefined && task.projectId) {
    return { tags: task.tags, projectId: task.projectId };
  }
  if (!task.projectId) return null;
  const detail = await api.getTask(task.projectId, task.id);
  return {
    tags: detail.tags ?? [],
    projectId: detail.projectId || task.projectId,
  };
}

/**
 * Webhook first, then todo → doing only if the webhook succeeds.
 */
export async function claimTodoTasks(
  api: DidaApi,
  todoTasks: DidaTask[],
  mergedIds: Set<string>,
  m: Markers,
  options: {
    webhookConfigured: boolean;
    postWork: (
      pending: PendingBotItem[],
    ) => Promise<{ ok: boolean; status: number }>;
    maxClaim: number;
  },
): Promise<PendingBotItem[]> {
  if (!options.webhookConfigured) return [];

  const seen = new Set<string>();
  const candidates: DidaTask[] = [];
  for (const task of todoTasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    if (!isTodoClaimCandidate(task.tags, m)) continue;
    if (
      isBotFragment(
        { title: task.title, content: task.content, tags: task.tags },
        m,
      )
    ) {
      continue;
    }
    candidates.push(task);
    if (candidates.length >= options.maxClaim) break;
  }

  if (candidates.length === 0) return [];

  const pendingPreview: PendingBotItem[] = [];
  const resolved: Array<{
    task: DidaTask;
    projectId: string;
    next: string[];
  }> = [];

  for (const task of candidates) {
    try {
      const info = await resolveTaskTags(api, task);
      if (!info) continue;
      if (!isTodoClaimCandidate(info.tags, m)) continue;
      const next = withBotLifecycleTag(m, info.tags, m.tagDoing);
      resolved.push({ task, projectId: info.projectId, next });
      pendingPreview.push({
        taskId: task.id,
        projectId: info.projectId,
        title: task.title ?? "",
        reason: mergedIds.has(task.id) ? "merged" : "standalone",
        tags: next,
        lifecycle: m.tagDoing,
      });
    } catch (error) {
      console.log(
        JSON.stringify({
          msg: "claim_resolve_failed",
          taskId: task.id,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  }

  if (pendingPreview.length === 0) return [];

  const posted = await options.postWork(pendingPreview);
  if (!posted.ok) {
    console.log(
      JSON.stringify({
        msg: "webhook_work_failed",
        status: posted.status,
        pending: pendingPreview.length,
      }),
    );
    return [];
  }

  const claimed: PendingBotItem[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const item = resolved[i];
    try {
      await api.updateTaskTags(item.task.id, item.projectId, item.next);
      claimed.push(pendingPreview[i]);
    } catch (error) {
      console.log(
        JSON.stringify({
          msg: "claim_doing_failed",
          taskId: item.task.id,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  }
  return claimed;
}

export async function dispatchBotWork(
  api: DidaApi,
  poolTasks: MergeTask[],
  merges: Array<{ contextId: string }>,
  m: Markers,
  options: {
    webhookConfigured: boolean;
    postWork: (
      pending: PendingBotItem[],
    ) => Promise<{ ok: boolean; status: number }>;
    maxClaim: number;
  },
): Promise<PendingBotItem[]> {
  await ensureBotTags(api, m);
  if (!options.webhookConfigured) return [];

  const filtered = await api.filterByTag([m.tagTodo]);
  const byId = new Map<string, DidaTask>();
  for (const task of filtered) {
    byId.set(task.id, task);
  }
  const mergedIds = new Set(merges.map((item) => item.contextId));
  for (const task of poolTasks) {
    if (!mergedIds.has(task.id)) continue;
    if (byId.has(task.id)) continue;
    byId.set(task.id, {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      content: task.content,
      createdTime: task.createdTime,
      status: task.status,
      tags: task.tags?.includes(m.tagTodo)
        ? task.tags
        : withBotLifecycleTag(m, task.tags, m.tagTodo),
    });
  }
  return claimTodoTasks(api, [...byId.values()], mergedIds, m, options);
}

export async function runMerge(
  api: DidaApi,
  config: AppConfig,
): Promise<{
  searched: number;
  inbox: number;
  pool: number;
  fragments: number;
  merges: MergeSummaryItem[];
  nots: Array<{ fragmentId: string; title: string }>;
  skipped: MergeRunResult["skipped"];
  poolTasks: MergeTask[];
}> {
  const m = config.markers;
  const skipped: MergeRunResult["skipped"] = [];
  const searched = await api.searchUnfinished(m.botMarker);
  const inbox = await api.listInbox();
  const combined = unionTasks(searched, inbox);
  const hydrated = await hydrateMissing(
    api,
    combined,
    skipped,
    config.maxHydrate,
  );
  let pool = hydrated
    .map(toMergeTask)
    .filter((task): task is MergeTask => task !== null);

  const { merges, nots, skipped: mergeSkipped } = await mergeFragments(
    api,
    config.dataDir,
    pool,
    m,
    config.maxMergeOrNot,
  );

  const deletedFragmentIds = new Set(
    merges
      .filter((item) => item.fragmentId !== item.contextId)
      .map((item) => item.fragmentId),
  );
  pool = pool.filter((task) => !deletedFragmentIds.has(task.id));
  for (const merge of merges) {
    const main = pool.find((task) => task.id === merge.contextId);
    if (main) {
      main.tags = withBotLifecycleTag(m, main.tags, m.tagTodo);
    }
  }

  return {
    searched: searched.length,
    inbox: inbox.length,
    pool: pool.length,
    fragments: pool.filter((task) => isBotFragment(task, m)).length,
    merges,
    nots,
    skipped: [...skipped, ...mergeSkipped],
    poolTasks: pool,
  };
}

function toStatus(
  result: MergeRunResult,
  config: AppConfig,
): RunStatus {
  return {
    at: new Date().toISOString(),
    ok: result.ok,
    locked: result.locked,
    error: result.error,
    enabled: config.enabled,
    searched: result.searched,
    inbox: result.inbox,
    pool: result.pool,
    fragments: result.fragments,
    mergedCount: result.mergedCount,
    notted: result.notted,
    claimed: result.claimed,
    skipped: result.skipped,
    merges: result.merges,
    nots: result.nots,
    pending: result.pending,
    webhook: result.webhook,
    markers: {
      botMarker: config.markers.botMarker,
      notMarker: config.markers.notMarker,
      tagTodo: config.markers.tagTodo,
      tagDoing: config.markers.tagDoing,
    },
    intervalSeconds: config.intervalSeconds,
    webhookConfigured: config.webhookUrl.length > 0,
    durationMs: result.durationMs,
  };
}

export async function runMergeAndNotify(
  config: AppConfig,
): Promise<MergeRunResult> {
  const started = Date.now();
  if (!config.enabled) {
    const result = emptyResult({
      ok: true,
      error: "disabled",
      durationMs: Date.now() - started,
    });
    writeStatus(config.dataDir, toStatus(result, config));
    return result;
  }

  if (!acquireMergeLock(config.dataDir)) {
    const result = emptyResult({
      ok: false,
      locked: true,
      error: "merge_locked",
      durationMs: Date.now() - started,
    });
    writeStatus(config.dataDir, toStatus(result, config));
    return result;
  }

  try {
    console.log(
      JSON.stringify({
        msg: "dida_cli_ready",
        binary: config.didaBinary,
      }),
    );

    const api = new DidaCliClient({ binary: config.didaBinary });
    const result = await runMerge(api, config);
    const mergedCount = result.merges.length;
    const notted = result.nots.length;
    const webhook: MergeRunResult["webhook"] = {};

    const webhookUrl = config.webhookUrl;
    let workWebhookStatus: number | undefined;
    const pending = await dispatchBotWork(
      api,
      result.poolTasks,
      result.merges,
      config.markers,
      {
        webhookConfigured: webhookUrl.length > 0,
        maxClaim: config.maxClaim,
        postWork: async (items) => {
          const posted = await postWebhook(
            webhookUrl,
            config.webhookSecret,
            config.webhookAuthStyle,
            {
              event: "dida_bot_work",
              source: "setup-dida-bot",
              mergedCount,
              merges: result.merges,
              pending: items,
            },
          );
          workWebhookStatus = posted.status;
          return posted;
        },
      },
    );
    if (workWebhookStatus !== undefined) {
      webhook.work = workWebhookStatus;
    }

    const claimed = pending.length;
    const out: MergeRunResult = {
      ok: true,
      searched: result.searched,
      inbox: result.inbox,
      pool: result.pool,
      fragments: result.fragments,
      mergedCount,
      notted,
      claimed,
      skipped: result.skipped,
      merges: result.merges,
      nots: result.nots,
      pending,
      webhook,
      durationMs: Date.now() - started,
    };

    console.log(
      JSON.stringify({
        msg: "merge_run",
        merged: mergedCount,
        notted,
        claimed,
        searched: result.searched,
        inbox: result.inbox,
        pool: result.pool,
        fragments: result.fragments,
        skipped: result.skipped.length,
        durationMs: out.durationMs,
      }),
    );

    writeStatus(config.dataDir, toStatus(out, config));
    return out;
  } catch (error) {
    const out = emptyResult({
      ok: false,
      error: error instanceof Error ? error.message : "unknown",
      durationMs: Date.now() - started,
    });
    writeStatus(config.dataDir, toStatus(out, config));
    return out;
  } finally {
    releaseMergeLock(config.dataDir);
  }
}
