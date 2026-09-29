/**
 * Configurable markers so local setup-dida-bot does not collide with the
 * production Cloudflare Worker (which uses @bot / todo / doing / done).
 *
 * Defaults are the local-safe set (@botx / x-todo / …). Flip via config.json
 * when you intentionally want production markers.
 */

export interface MarkersConfig {
  botMarker: string;
  notMarker: string;
  wechatCaptureTag: string;
  tagParent: string;
  tagTodo: string;
  tagDoing: string;
  tagDone: string;
  tagFreeze: string;
  ensureParentTag?: boolean;
  dependencyWindowBeforeMs?: number;
  dependencyWindowAfterMs?: number;
}

export interface Markers {
  botMarker: string;
  notMarker: string;
  wechatCaptureTag: string;
  tagParent: string;
  tagTodo: string;
  tagDoing: string;
  tagDone: string;
  tagFreeze: string;
  ensureParentTag: boolean;
  appendSeparator: string;
  dependencyWindowBeforeMs: number;
  dependencyWindowAfterMs: number;
  lifecycleTags: readonly string[];
  nestedTags: readonly string[];
  lifecycleTagSet: ReadonlySet<string>;
}

export const APPEND_SEPARATOR = "\n\n---\n\n";

export const DEFAULT_MARKERS_CONFIG: MarkersConfig = {
  botMarker: "@botx",
  notMarker: "@notx",
  wechatCaptureTag: "微信采集",
  tagParent: "x-bot",
  tagTodo: "x-todo",
  tagDoing: "x-doing",
  tagDone: "x-done",
  tagFreeze: "x-freeze",
  ensureParentTag: true,
  dependencyWindowBeforeMs: 10_000,
  dependencyWindowAfterMs: 10_000,
};

export function createMarkers(partial?: Partial<MarkersConfig>): Markers {
  const cfg = { ...DEFAULT_MARKERS_CONFIG, ...partial };
  const lifecycleTags = [cfg.tagTodo, cfg.tagDoing, cfg.tagDone] as const;
  return {
    botMarker: cfg.botMarker,
    notMarker: cfg.notMarker,
    wechatCaptureTag: cfg.wechatCaptureTag,
    tagParent: cfg.tagParent,
    tagTodo: cfg.tagTodo,
    tagDoing: cfg.tagDoing,
    tagDone: cfg.tagDone,
    tagFreeze: cfg.tagFreeze,
    ensureParentTag: cfg.ensureParentTag !== false,
    appendSeparator: APPEND_SEPARATOR,
    dependencyWindowBeforeMs: cfg.dependencyWindowBeforeMs ?? 10_000,
    dependencyWindowAfterMs: cfg.dependencyWindowAfterMs ?? 10_000,
    lifecycleTags,
    nestedTags: [...lifecycleTags, cfg.tagFreeze],
    lifecycleTagSet: new Set(lifecycleTags),
  };
}

export type BotLifecycleTag = string;

export function isBotLifecycleTag(m: Markers, tag: string): boolean {
  return m.lifecycleTagSet.has(tag);
}

export function hasBotLifecycleTag(
  m: Markers,
  tags: readonly string[] | undefined | null,
): boolean {
  if (!tags) return false;
  return tags.some((tag) => isBotLifecycleTag(m, tag));
}

/**
 * One task one lifecycle leaf: drop todo/doing/done variants, keep unrelated
 * tags (including freeze), then append `next`.
 */
export function withBotLifecycleTag(
  m: Markers,
  tags: readonly string[] | undefined | null,
  next: string,
): string[] {
  const kept = (tags ?? []).filter((tag) => !isBotLifecycleTag(m, tag));
  return [...kept, next];
}

export function hasFreezeTag(
  m: Markers,
  tags: readonly string[] | undefined | null,
): boolean {
  if (!tags) return false;
  return tags.includes(m.tagFreeze);
}

export function withFreezeTag(
  m: Markers,
  tags: readonly string[] | undefined | null,
): string[] {
  const current = tags ?? [];
  if (current.includes(m.tagFreeze)) return [...current];
  return [...current, m.tagFreeze];
}
