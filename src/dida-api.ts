import { execFile } from "node:child_process";

export interface DidaTask {
  id: string;
  projectId: string;
  title?: string | null;
  content?: string | null;
  createdTime?: string | null;
  status?: number | null;
  tags?: string[];
}

export interface DidaTag {
  name: string;
  label?: string | null;
  parent?: string | null;
  color?: string | null;
}

export interface CreateTagInput {
  name: string;
  label?: string;
  parent?: string;
  color?: string;
}

export interface CreateTaskInput {
  title: string;
  content?: string;
  projectId?: string;
  tags?: string[];
}

export class DidaApiError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(status: number, body: string) {
    const snippet = body.slice(0, 300);
    super(`Dida API ${status}: ${snippet}`);
    this.name = "DidaApiError";
    this.status = status;
    this.bodySnippet = snippet;
  }
}

export interface TaskUpdateFields {
  content?: string;
  tags?: string[];
  title?: string;
}

export interface DidaApi {
  searchUnfinished(keywords: string): Promise<DidaTask[]>;
  listInbox(): Promise<DidaTask[]>;
  getTask(projectId: string, taskId: string): Promise<DidaTask>;
  updateTask(
    taskId: string,
    projectId: string,
    fields: TaskUpdateFields,
  ): Promise<void>;
  updateTaskTags(
    taskId: string,
    projectId: string,
    tags: string[],
  ): Promise<void>;
  filterByTag(tags: string[]): Promise<DidaTask[]>;
  listTags(): Promise<DidaTag[]>;
  createTag(tag: CreateTagInput): Promise<void>;
  createTask(input: CreateTaskInput): Promise<DidaTask>;
  deleteTask(projectId: string, taskId: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function asTask(value: unknown): DidaTask | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  const projectId =
    typeof value.projectId === "string"
      ? value.projectId
      : typeof value.project_id === "string"
        ? value.project_id
        : "";
  return {
    id: value.id,
    projectId,
    title: typeof value.title === "string" ? value.title : "",
    content:
      typeof value.content === "string"
        ? value.content
        : value.content === null
          ? null
          : undefined,
    createdTime:
      typeof value.createdTime === "string"
        ? value.createdTime
        : typeof value.created_time === "string"
          ? value.created_time
          : null,
    status: typeof value.status === "number" ? value.status : undefined,
    tags: parseTags(value.tags),
  };
}

function asTag(value: unknown): DidaTag | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string" || value.name.length === 0) return null;
  const parentRaw = value.parent;
  const parent =
    typeof parentRaw === "string" && parentRaw.length > 0 ? parentRaw : null;
  return {
    name: value.name,
    label: typeof value.label === "string" ? value.label : undefined,
    parent,
    color: typeof value.color === "string" ? value.color : null,
  };
}

export function normalizeTags(payload: unknown): DidaTag[] {
  if (Array.isArray(payload)) {
    return payload.map(asTag).filter((tag): tag is DidaTag => tag !== null);
  }
  if (!isRecord(payload)) return [];
  for (const key of ["tags", "data", "list", "content"]) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    const tags = value.map(asTag).filter((tag): tag is DidaTag => tag !== null);
    if (tags.length > 0) return tags;
  }
  return [];
}

function extractTaskArray(payload: unknown): DidaTask[] {
  if (Array.isArray(payload)) {
    return payload.map(asTask).filter((t): t is DidaTask => t !== null);
  }
  if (!isRecord(payload)) return [];
  const keys = ["tasks", "undoneTasks", "content", "data", "list"];
  const out: DidaTask[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const task = asTask(item);
      if (task && !seen.has(task.id)) {
        seen.add(task.id);
        out.push(task);
      }
    }
  }
  return out;
}

export function normalizeInboxTasks(payload: unknown): DidaTask[] {
  if (Array.isArray(payload)) {
    return payload.map(asTask).filter((t): t is DidaTask => t !== null);
  }
  if (!isRecord(payload)) return [];
  const combined: unknown[] = [];
  if (Array.isArray(payload.tasks)) combined.push(...payload.tasks);
  if (Array.isArray(payload.undoneTasks)) combined.push(...payload.undoneTasks);
  const seen = new Set<string>();
  const out: DidaTask[] = [];
  for (const item of combined) {
    const task = asTask(item);
    if (task && !seen.has(task.id)) {
      seen.add(task.id);
      out.push(task);
    }
  }
  return out;
}

export function normalizeSearchTasks(payload: unknown): DidaTask[] {
  return extractTaskArray(payload);
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Injected in tests. Production uses `execFile` with no shell. */
export type CliRunner = (
  binary: string,
  args: string[],
) => Promise<CliRunResult>;

export interface DidaCliOptions {
  /** Executable name or path. Default `dida` on PATH. */
  binary?: string;
  run?: CliRunner;
}

const CLI_MAX_BUFFER = 20 * 1024 * 1024;

export function execFileCliRunner(
  binary: string,
  args: string[],
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        maxBuffer: CLI_MAX_BUFFER,
        timeout: 60_000,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const errno = error as NodeJS.ErrnoException | null;
        if (errno && errno.code === "ENOENT") {
          reject(
            new DidaApiError(
              127,
              `找不到 dida 命令「${binary}」。请安装 @suibiji/dida-cli，并执行 dida auth login`,
            ),
          );
          return;
        }
        const code =
          errno && typeof errno.code === "number"
            ? errno.code
            : errno
              ? 1
              : 0;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code,
        });
      },
    );
  });
}

function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/((?:access_token|refresh_token|webhookSecret)"?\s*[:=]\s*"?)[^\s",}]+/gi, "$1***")
    .slice(0, 300);
}

function parseCliStatus(stderr: string): number | null {
  const match = stderr.match(/DIDA API 错误\s+(\d+)/);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function isAuthFailure(stderr: string): boolean {
  return /未找到 access token|dida auth login/i.test(stderr);
}

function assertNoComma(values: readonly string[], label: string): void {
  if (values.some((value) => value.includes(","))) {
    throw new DidaApiError(400, `${label} 不能包含逗号`);
  }
}

function flag(name: string, value: string): string {
  return `--${name}=${value}`;
}

/**
 * Dida reads and writes go through the `dida` CLI (`--json`), not a direct HTTP client.
 */
export class DidaCliClient implements DidaApi {
  private readonly binary: string;
  private readonly run: CliRunner;

  constructor(options: DidaCliOptions = {}) {
    const binary = options.binary?.trim() || "dida";
    this.binary = binary;
    this.run = options.run ?? execFileCliRunner;
  }

  private async invoke(args: string[]): Promise<unknown> {
    let result: CliRunResult;
    try {
      result = await this.run(this.binary, args);
    } catch (error) {
      if (error instanceof DidaApiError) throw error;
      const message = error instanceof Error ? error.message : "dida cli failed";
      throw new DidaApiError(127, redactSecrets(message));
    }

    if (result.code !== 0) {
      const stderr = result.stderr || result.stdout || "";
      if (isAuthFailure(stderr)) {
        throw new DidaApiError(401, "dida 未登录。请先运行 dida auth login");
      }
      const status = parseCliStatus(stderr) ?? 1;
      throw new DidaApiError(status, redactSecrets(stderr || `dida exit ${result.code}`));
    }

    const text = result.stdout.trim();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new DidaApiError(1, "dida 输出不是 JSON");
    }
  }

  async searchUnfinished(keywords: string): Promise<DidaTask[]> {
    try {
      const payload = await this.invoke([
        "task",
        "search",
        "--status=0",
        "--json",
        keywords,
      ]);
      return normalizeSearchTasks(payload);
    } catch (error) {
      if (error instanceof DidaApiError && error.status >= 500) {
        console.log(
          JSON.stringify({
            msg: "dida_search_failed",
            status: error.status,
          }),
        );
        return [];
      }
      throw error;
    }
  }

  async listInbox(): Promise<DidaTask[]> {
    const payload = await this.invoke([
      "project",
      "data",
      "inbox",
      "--json",
    ]);
    return normalizeInboxTasks(payload);
  }

  async getTask(projectId: string, taskId: string): Promise<DidaTask> {
    const payload = await this.invoke([
      "task",
      "get",
      projectId,
      taskId,
      "--json",
    ]);
    const task = asTask(payload);
    if (!task) {
      throw new DidaApiError(500, "task detail missing id");
    }
    return task;
  }

  async updateTask(
    taskId: string,
    projectId: string,
    fields: TaskUpdateFields,
  ): Promise<void> {
    const args = [
      "task",
      "update",
      taskId,
      flag("id", taskId),
      flag("project", projectId),
      "--json",
    ];
    if (fields.title !== undefined) args.push(flag("title", fields.title));
    if (fields.content !== undefined) args.push(flag("content", fields.content));
    if (fields.tags !== undefined) {
      assertNoComma(fields.tags, "tags");
      args.push(flag("tags", fields.tags.join(",")));
    }
    await this.invoke(args);
  }

  async updateTaskTags(
    taskId: string,
    projectId: string,
    tags: string[],
  ): Promise<void> {
    await this.updateTask(taskId, projectId, { tags });
  }

  /** Unfinished tasks carrying these leaf tag names. CLI flag is `--tag`. */
  async filterByTag(tags: string[]): Promise<DidaTask[]> {
    assertNoComma(tags, "tag");
    if (tags.length === 0) {
      throw new DidaApiError(400, "filter tag 不能为空");
    }
    const payload = await this.invoke([
      "task",
      "filter",
      "--json",
      flag("tag", tags.join(",")),
      "--status=0",
    ]);
    return normalizeSearchTasks(payload);
  }

  async listTags(): Promise<DidaTag[]> {
    const payload = await this.invoke(["tag", "list", "--json"]);
    return normalizeTags(payload);
  }

  async createTag(tag: CreateTagInput): Promise<void> {
    const label = tag.label ?? tag.name;
    const args = [
      "tag",
      "create",
      flag("name", tag.name),
      flag("label", label),
      "--json",
    ];
    if (tag.parent) args.push(flag("parent", tag.parent));
    if (tag.color) args.push(flag("color", tag.color));
    await this.invoke(args);
  }

  async createTask(input: CreateTaskInput): Promise<DidaTask> {
    const projectId = input.projectId?.trim() || "inbox";
    const args = [
      "task",
      "create",
      flag("title", input.title),
      flag("project", projectId),
      "--json",
    ];
    if (input.content !== undefined) args.push(flag("content", input.content));
    if (input.tags) {
      assertNoComma(input.tags, "tags");
      args.push(flag("tags", input.tags.join(",")));
    }
    const payload = await this.invoke(args);
    const task = asTask(payload);
    if (!task) {
      throw new DidaApiError(500, "create task missing id");
    }
    return task;
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.invoke(["task", "delete", projectId, taskId]);
  }
}
