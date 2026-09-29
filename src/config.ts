import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  createMarkers,
  type Markers,
  type MarkersConfig,
  DEFAULT_MARKERS_CONFIG,
} from "./markers.ts";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type WebhookAuthStyle = "bearer" | "header" | "both";

export interface AppConfig {
  enabled: boolean;
  intervalSeconds: number;
  /** `dida` on PATH, or an absolute path to the binary. */
  didaBinary: string;
  webhookUrl: string;
  webhookSecret: string;
  webhookAuthStyle: WebhookAuthStyle;
  maxMergeOrNot: number;
  maxClaim: number;
  maxHydrate: number;
  uiHost: string;
  uiPort: number;
  dataDir: string;
  markers: Markers;
  /** Absolute path to the resolved config file (if any). */
  configPath: string;
  projectRoot: string;
}

export interface RawConfig extends Partial<MarkersConfig> {
  enabled?: boolean;
  intervalSeconds?: number;
  didaBinary?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookAuthStyle?: string;
  maxMergeOrNot?: number;
  maxClaim?: number;
  maxHydrate?: number;
  uiHost?: string;
  uiPort?: number;
  dataDir?: string;
  ensureParentTag?: boolean;
  dependencyWindowBeforeMs?: number;
  dependencyWindowAfterMs?: number;
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (path === "~") return homedir();
  return path;
}

function parseAuthStyle(raw: string | undefined): WebhookAuthStyle {
  const value = (raw ?? "both").trim().toLowerCase();
  if (value === "bearer" || value === "header" || value === "both") return value;
  return "both";
}

function resolveDataDir(raw: string | undefined): string {
  const value = raw?.trim() || "data";
  if (isAbsolute(value)) return value;
  return resolve(PROJECT_ROOT, value);
}

export function loadRawConfig(configPath?: string): {
  raw: RawConfig;
  path: string;
} {
  const candidates = [
    configPath,
    process.env.SETUP_DIDA_BOT_CONFIG,
    resolve(PROJECT_ROOT, "config.json"),
    resolve(PROJECT_ROOT, "config.example.json"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  for (const candidate of candidates) {
    const path = expandHome(candidate);
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf8")) as RawConfig;
    return { raw, path };
  }
  return { raw: {}, path: resolve(PROJECT_ROOT, "config.json") };
}

export function loadConfig(configPath?: string): AppConfig {
  const { raw, path } = loadRawConfig(configPath);
  const markers = createMarkers({
    botMarker: raw.botMarker ?? DEFAULT_MARKERS_CONFIG.botMarker,
    notMarker: raw.notMarker ?? DEFAULT_MARKERS_CONFIG.notMarker,
    wechatCaptureTag:
      raw.wechatCaptureTag ?? DEFAULT_MARKERS_CONFIG.wechatCaptureTag,
    tagParent: raw.tagParent ?? DEFAULT_MARKERS_CONFIG.tagParent,
    tagTodo: raw.tagTodo ?? DEFAULT_MARKERS_CONFIG.tagTodo,
    tagDoing: raw.tagDoing ?? DEFAULT_MARKERS_CONFIG.tagDoing,
    tagDone: raw.tagDone ?? DEFAULT_MARKERS_CONFIG.tagDone,
    tagFreeze: raw.tagFreeze ?? DEFAULT_MARKERS_CONFIG.tagFreeze,
    ensureParentTag: raw.ensureParentTag,
    dependencyWindowBeforeMs: raw.dependencyWindowBeforeMs,
    dependencyWindowAfterMs: raw.dependencyWindowAfterMs,
  });

  return {
    enabled: raw.enabled !== false,
    intervalSeconds: Math.max(15, Number(raw.intervalSeconds) || 120),
    didaBinary: expandHome((raw.didaBinary ?? "dida").trim() || "dida"),
    webhookUrl: (raw.webhookUrl ?? "").trim(),
    webhookSecret: raw.webhookSecret ?? "",
    webhookAuthStyle: parseAuthStyle(raw.webhookAuthStyle),
    maxMergeOrNot: Math.max(1, Number(raw.maxMergeOrNot) || 10),
    maxClaim: Math.max(1, Number(raw.maxClaim) || 8),
    maxHydrate: Math.max(0, Number(raw.maxHydrate) || 10),
    uiHost: raw.uiHost ?? "127.0.0.1",
    uiPort: Number(raw.uiPort) || 8788,
    dataDir: resolveDataDir(raw.dataDir),
    markers,
    configPath: path,
    projectRoot: PROJECT_ROOT,
  };
}

export function saveRawConfigPatch(
  configPath: string,
  patch: Partial<RawConfig>,
): RawConfig {
  const path = expandHome(configPath);
  let existing: RawConfig = {};
  if (existsSync(path)) {
    existing = JSON.parse(readFileSync(path, "utf8")) as RawConfig;
  }
  const next = { ...existing, ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export { PROJECT_ROOT };
