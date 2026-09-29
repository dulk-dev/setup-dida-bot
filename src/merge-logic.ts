import {
  hasFreezeTag,
  type Markers,
  createMarkers,
} from "./markers.ts";

export interface MergeTask {
  id: string;
  projectId: string;
  title: string;
  content: string;
  createdTime?: string;
  status?: number;
  tags?: string[];
}

export type SkipReason =
  | "no_created_time"
  | "waiting_deps"
  | "already_processed";

export interface DepMerge {
  fragment: MergeTask;
  dep: MergeTask;
}

export interface SkippedFragment {
  fragment: MergeTask;
  reason: SkipReason;
}

export interface FragmentPlan {
  merges: DepMerge[];
  nots: MergeTask[];
  skipped: SkippedFragment[];
}

const defaultMarkers = createMarkers();

/**
 * Truncate a Dida `createdTime` string to second precision for display.
 */
export function createdTimeSecond(
  createdTime: string | undefined | null,
): string | null {
  if (!createdTime) return null;
  const match = createdTime.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

/**
 * Parse Dida `createdTime` to epoch ms. Normalizes `+0800` → `+08:00`.
 */
export function parseCreatedTimeMs(
  createdTime: string | undefined | null,
): number | null {
  if (!createdTime) return null;
  const normalized = createdTime.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/** Inclusive real-time window [T−BEFORE, T+AFTER] around fragment createdTime T. */
export function isInDependencyWindow(
  anchorMs: number,
  candidateMs: number,
  beforeMs = defaultMarkers.dependencyWindowBeforeMs,
  afterMs = defaultMarkers.dependencyWindowAfterMs,
): boolean {
  const delta = candidateMs - anchorMs;
  return delta >= -beforeMs && delta <= afterMs;
}

export function isContentEmpty(
  content: string | null | undefined,
): boolean {
  return content == null || content.length === 0;
}

export function hasNotMarker(
  title: string | null | undefined,
  m: Markers = defaultMarkers,
): boolean {
  return (title ?? "").includes(m.notMarker);
}

/**
 * Belt and suspenders: never auto-merge already-`@notx` or already-`x-freeze`
 * fragments.
 */
export function shouldSkipAutoMerge(
  task: {
    title?: string | null;
    tags?: readonly string[] | null;
  },
  m: Markers = defaultMarkers,
): boolean {
  return hasNotMarker(task.title, m) || hasFreezeTag(m, task.tags);
}

export function hasWeChatCaptureTag(
  tags: readonly string[] | undefined | null,
  m: Markers = defaultMarkers,
): boolean {
  if (!tags) return false;
  return tags.includes(m.wechatCaptureTag);
}

/**
 * Dependency fragment: title contains botMarker, content empty/null, and not notMarker.
 */
export function isBotFragment(
  task: {
    title?: string | null;
    content?: string | null;
    tags?: readonly string[] | null;
  },
  m: Markers = defaultMarkers,
): boolean {
  const title = task.title ?? "";
  if (hasNotMarker(title, m)) return false;
  if (!title.includes(m.botMarker)) return false;
  return isContentEmpty(task.content);
}

/** Instruction text to append: prefer non-empty content, else title. */
export function fragmentPayload(task: MergeTask): string {
  if (task.content.length > 0) return task.content;
  return task.title;
}

export function rewriteBotTitleToNot(
  title: string,
  m: Markers = defaultMarkers,
): string {
  return title.replaceAll(m.botMarker, m.notMarker);
}

const WECHAT_MEDIA_TITLE = /^来自微信的(图片|文件|视频|语音|链接)/;

/** Media-only WeChat stub: known title and empty content. */
export function isWeChatMediaOnly(task: {
  title?: string | null;
  content?: string | null;
}): boolean {
  const content = task.content ?? "";
  const title = (task.title ?? "").trim();
  return content.length === 0 && WECHAT_MEDIA_TITLE.test(title);
}

/** Non-fragment has usable text (not a media-only stub). */
export function depHasSubstance(task: MergeTask): boolean {
  if (isWeChatMediaOnly(task)) return false;
  if ((task.content ?? "").trim().length > 0) return true;
  return (task.title ?? "").trim().length > 0;
}

export function mediaOrTaskRef(task: MergeTask): string {
  const title = (task.title ?? "").trim() || "微信依赖";
  return `${title} (taskId: ${task.id})`;
}

export interface MergeMainChoice {
  main: MergeTask;
  payload: string;
  deleteFragment: boolean;
}

/**
 * Prefer the non-fragment as main when it has substance (classic context).
 * Media-only deps keep the fragment as main and append a ref.
 */
export function chooseMergeMain(
  fragment: MergeTask,
  dep: MergeTask,
): MergeMainChoice {
  if (depHasSubstance(dep)) {
    return {
      main: dep,
      payload: fragmentPayload(fragment),
      deleteFragment: true,
    };
  }
  return {
    main: fragment,
    payload: mediaOrTaskRef(dep),
    deleteFragment: false,
  };
}

/**
 * Append fragment payload to context content with a markdown `---` separator.
 * Idempotent: if the payload is already present, return the existing content.
 */
export function appendFragmentContent(
  existing: string | undefined | null,
  payload: string,
  separator = defaultMarkers.appendSeparator,
): { content: string; appended: boolean } {
  const base = existing ?? "";
  if (payload.length > 0 && contentAlreadyHasPayload(base, payload, separator)) {
    return { content: base, appended: false };
  }
  return { content: `${base}${separator}${payload}`, appended: true };
}

export function contentAlreadyHasPayload(
  content: string,
  payload: string,
  separator = defaultMarkers.appendSeparator,
): boolean {
  if (payload.length === 0) return true;
  if (content.includes(`${separator}${payload}`)) return true;
  if (content === payload) return true;
  return false;
}

export function findDependencyCandidates(
  fragment: MergeTask,
  pool: MergeTask[],
  m: Markers = defaultMarkers,
): MergeTask[] {
  const anchorMs = parseCreatedTimeMs(fragment.createdTime);
  if (anchorMs === null) return [];
  return pool.filter((task) => {
    if (task.id === fragment.id) return false;
    if (task.projectId !== fragment.projectId) return false;
    if (!hasWeChatCaptureTag(task.tags, m)) return false;
    if (isBotFragment(task, m)) return false;
    if (hasNotMarker(task.title, m)) return false;
    const ms = parseCreatedTimeMs(task.createdTime);
    if (ms === null) return false;
    return isInDependencyWindow(
      anchorMs,
      ms,
      m.dependencyWindowBeforeMs,
      m.dependencyWindowAfterMs,
    );
  });
}

/**
 * Plan merge / notMarker / skip for each dependency fragment.
 * 0 candidates → skip this run (retry next poll).
 * 1 candidate → merge.
 * ≥2 candidates → rewrite botMarker → notMarker and tag freeze (caller writes).
 */
export function planFragmentActions(
  tasks: MergeTask[],
  m: Markers = defaultMarkers,
): FragmentPlan {
  const fragments = tasks
    .filter((task) => isBotFragment(task, m))
    .slice()
    .sort((a, b) => {
      const am = parseCreatedTimeMs(a.createdTime) ?? Number.POSITIVE_INFINITY;
      const bm = parseCreatedTimeMs(b.createdTime) ?? Number.POSITIVE_INFINITY;
      if (am !== bm) return am - bm;
      return a.id.localeCompare(b.id);
    });

  const merges: DepMerge[] = [];
  const nots: MergeTask[] = [];
  const skipped: SkippedFragment[] = [];

  for (const fragment of fragments) {
    if (shouldSkipAutoMerge(fragment, m)) {
      continue;
    }
    const anchorMs = parseCreatedTimeMs(fragment.createdTime);
    if (anchorMs === null) {
      skipped.push({ fragment, reason: "no_created_time" });
      continue;
    }
    const candidates = findDependencyCandidates(fragment, tasks, m);
    if (candidates.length === 0) {
      skipped.push({ fragment, reason: "waiting_deps" });
      continue;
    }
    if (candidates.length >= 2) {
      nots.push(fragment);
      continue;
    }
    merges.push({ fragment, dep: candidates[0] });
  }

  return { merges, nots, skipped };
}

export function shanghaiCalendarDate(
  at: Date,
  timeZone = "Asia/Shanghai",
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function daysUntil(expiresAtMs: number, nowMs: number): number {
  return (expiresAtMs - nowMs) / (24 * 60 * 60 * 1000);
}

/** Prefer filter hits; unknown tags are still claimable (filter asked for todo). */
export function isTodoClaimCandidate(
  tags: string[] | undefined,
  m: Markers = defaultMarkers,
): boolean {
  if (tags === undefined) return true;
  return tags.includes(m.tagTodo);
}
