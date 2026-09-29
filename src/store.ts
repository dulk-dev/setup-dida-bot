import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  openSync,
  closeSync,
  constants,
} from "node:fs";
import { join } from "node:path";

const LOCK_STALE_MS = 120_000;
const PROCESSED_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export interface RunStatus {
  at: string;
  ok: boolean;
  locked?: boolean;
  error?: string;
  enabled?: boolean;
  searched?: number;
  inbox?: number;
  pool?: number;
  fragments?: number;
  mergedCount?: number;
  notted?: number;
  claimed?: number;
  skipped?: Array<{ fragmentId: string; reason: string }>;
  merges?: unknown[];
  nots?: unknown[];
  pending?: unknown[];
  webhook?: { work?: number };
  markers?: {
    botMarker: string;
    notMarker: string;
    tagTodo: string;
    tagDoing: string;
  };
  intervalSeconds?: number;
  webhookConfigured?: boolean;
  durationMs?: number;
}

interface ProcessedMap {
  [fragmentId: string]: number;
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function lockPath(dataDir: string): string {
  return join(dataDir, "merge.lock");
}

function processedPath(dataDir: string): string {
  return join(dataDir, "processed.json");
}

function statusPath(dataDir: string): string {
  return join(dataDir, "status.json");
}

export function acquireMergeLock(dataDir: string): boolean {
  ensureDir(dataDir);
  const path = lockPath(dataDir);
  try {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    writeFileSync(fd, `${Date.now()}\n${process.pid}\n`, "utf8");
    closeSync(fd);
    return true;
  } catch {
    if (!existsSync(path)) return false;
    try {
      const raw = readFileSync(path, "utf8");
      const started = Number(raw.split("\n")[0]);
      if (Number.isFinite(started) && Date.now() - started > LOCK_STALE_MS) {
        unlinkSync(path);
        return acquireMergeLock(dataDir);
      }
    } catch {
      // ignore
    }
    return false;
  }
}

export function releaseMergeLock(dataDir: string): void {
  try {
    unlinkSync(lockPath(dataDir));
  } catch {
    // ignore
  }
}

function loadProcessed(dataDir: string): ProcessedMap {
  const path = processedPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProcessedMap;
  } catch {
    return {};
  }
}

function saveProcessed(dataDir: string, map: ProcessedMap): void {
  ensureDir(dataDir);
  const path = processedPath(dataDir);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function isFragmentProcessed(
  dataDir: string,
  fragmentId: string,
): boolean {
  const map = loadProcessed(dataDir);
  const at = map[fragmentId];
  if (!at) return false;
  if (Date.now() - at > PROCESSED_TTL_MS) {
    delete map[fragmentId];
    saveProcessed(dataDir, map);
    return false;
  }
  return true;
}

export function markFragmentProcessed(
  dataDir: string,
  fragmentId: string,
): void {
  const map = loadProcessed(dataDir);
  map[fragmentId] = Date.now();
  // prune stale
  const cutoff = Date.now() - PROCESSED_TTL_MS;
  for (const [id, ts] of Object.entries(map)) {
    if (ts < cutoff) delete map[id];
  }
  saveProcessed(dataDir, map);
}

export function writeStatus(dataDir: string, status: RunStatus): void {
  ensureDir(dataDir);
  const path = statusPath(dataDir);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function readStatus(dataDir: string): RunStatus | null {
  const path = statusPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RunStatus;
  } catch {
    return null;
  }
}
