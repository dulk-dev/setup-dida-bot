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

export class DidaClient implements DidaApi {
  constructor(
    private readonly accessToken: string,
    private readonly apiBase: string,
  ) {}

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers,
      body: payload,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new DidaApiError(response.status, text);
    }
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new DidaApiError(response.status, "invalid JSON");
    }
  }

  async searchUnfinished(keywords: string): Promise<DidaTask[]> {
    try {
      const payload = await this.request("POST", "/task/search", {
        keywords,
        status: [0],
      });
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
    const payload = await this.request("GET", "/project/inbox/data");
    return normalizeInboxTasks(payload);
  }

  async getTask(projectId: string, taskId: string): Promise<DidaTask> {
    const payload = await this.request(
      "GET",
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
    );
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
    await this.request("POST", `/task/${encodeURIComponent(taskId)}`, {
      id: taskId,
      projectId,
      ...fields,
    });
  }

  async updateTaskTags(
    taskId: string,
    projectId: string,
    tags: string[],
  ): Promise<void> {
    await this.updateTask(taskId, projectId, { tags });
  }

  /**
   * Unfinished tasks with the given leaf tag names.
   * Field must be `tag` (not `tags`).
   */
  async filterByTag(tags: string[]): Promise<DidaTask[]> {
    const payload = await this.request("POST", "/task/filter", {
      status: [0],
      tag: tags,
    });
    return normalizeSearchTasks(payload);
  }

  async listTags(): Promise<DidaTag[]> {
    const payload = await this.request("GET", "/tag");
    return normalizeTags(payload);
  }

  async createTag(tag: CreateTagInput): Promise<void> {
    const body: Record<string, string> = { name: tag.name };
    if (tag.label) body.label = tag.label;
    if (tag.parent) body.parent = tag.parent;
    if (tag.color) body.color = tag.color;
    await this.request("POST", "/tag", body);
  }

  async createTask(input: CreateTaskInput): Promise<DidaTask> {
    const body: Record<string, unknown> = {
      title: input.title,
    };
    if (input.content !== undefined) body.content = input.content;
    if (input.projectId) body.projectId = input.projectId;
    if (input.tags) body.tags = input.tags;
    const payload = await this.request("POST", "/task", body);
    const task = asTask(payload);
    if (!task) {
      throw new DidaApiError(500, "create task missing id");
    }
    return task;
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
    );
  }
}
