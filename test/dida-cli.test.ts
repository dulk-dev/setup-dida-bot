import { describe, expect, it } from "vitest";
import {
  DidaApiError,
  DidaCliClient,
  type CliRunResult,
  type CliRunner,
} from "../src/dida-api.ts";

interface Recorded {
  binary: string;
  args: string[];
}

function json(value: unknown): CliRunResult {
  return { stdout: `${JSON.stringify(value)}\n`, stderr: "", code: 0 };
}

function scripted(handlers: (args: string[]) => CliRunResult): {
  run: CliRunner;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const run: CliRunner = async (binary, args) => {
    calls.push({ binary, args });
    return handlers(args);
  };
  return { run, calls };
}

const task = {
  id: "64f0aa0000000000000000c1",
  projectId: "inbox",
  title: "来自微信的文字",
  content: "正文",
  createdTime: "2026-09-29T20:15:03+0800",
  status: 0,
  tags: ["微信采集", "todo"],
};

describe("DidaCliClient", () => {
  it("searches unfinished tasks and lists the inbox through dida --json", async () => {
    const fake = scripted((args) => {
      if (args[0] === "task" && args[1] === "search") return json([task]);
      if (args[0] === "project" && args[1] === "data") {
        return json({ tasks: [task], columns: [] });
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const api = new DidaCliClient({ binary: "dida", run: fake.run });

    const searched = await api.searchUnfinished("@bot");
    const inbox = await api.listInbox();

    expect(searched).toEqual([task]);
    expect(inbox).toEqual([task]);
    expect(fake.calls.map((call) => call.args)).toEqual([
      ["task", "search", "--status=0", "--json", "@bot"],
      ["project", "data", "inbox", "--json"],
    ]);
    expect(fake.calls.every((call) => call.binary === "dida")).toBe(true);
  });

  it("filters with --tag and maps get, create, update, delete, and tags", async () => {
    const fake = scripted((args) => {
      const joined = args.join(" ");
      if (joined.startsWith("task filter")) return json([task]);
      if (joined.startsWith("task get")) return json(task);
      if (joined.startsWith("task create")) return json(task);
      if (joined.startsWith("task update")) return json(task);
      if (joined.startsWith("task delete")) {
        return { stdout: "", stderr: "", code: 0 };
      }
      if (joined.startsWith("tag list")) {
        return json([{ name: "todo", label: "todo", parent: "bot" }]);
      }
      if (joined.startsWith("tag create")) return json({ name: "doing", label: "doing" });
      throw new Error(`unexpected ${joined}`);
    });
    const api = new DidaCliClient({ binary: "/opt/dida", run: fake.run });

    expect(await api.filterByTag(["todo"])).toEqual([task]);
    expect((await api.getTask("inbox", task.id)).id).toBe(task.id);
    expect(
      (
        await api.createTask({
          title: "碎片 @bot",
          content: "",
          tags: ["微信采集"],
        })
      ).projectId,
    ).toBe("inbox");
    await api.updateTask(task.id, "inbox", {
      content: "正文\n\n---\n\n碎片",
      tags: ["微信采集", "doing"],
    });
    await api.updateTaskTags(task.id, "inbox", ["微信采集", "done"]);
    await api.deleteTask("inbox", task.id);
    expect((await api.listTags()).map((tag) => tag.name)).toEqual(["todo"]);
    await api.createTag({ name: "doing", label: "doing", parent: "bot" });

    expect(fake.calls[0]?.args).toEqual([
      "task",
      "filter",
      "--json",
      "--tag=todo",
      "--status=0",
    ]);
    expect(fake.calls[0]?.args.join(" ")).not.toContain("--tags");
    expect(fake.calls[1]?.args).toEqual([
      "task",
      "get",
      "inbox",
      task.id,
      "--json",
    ]);
    expect(fake.calls[2]?.args).toEqual([
      "task",
      "create",
      "--title=碎片 @bot",
      "--project=inbox",
      "--json",
      "--content=",
      "--tags=微信采集",
    ]);
    expect(fake.calls[3]?.args).toContain("--tags=微信采集,doing");
    expect(fake.calls[4]?.args).toContain("--tags=微信采集,done");
    expect(fake.calls[5]?.args).toEqual(["task", "delete", "inbox", task.id]);
    expect(fake.calls[7]?.args).toEqual([
      "tag",
      "create",
      "--name=doing",
      "--label=doing",
      "--json",
      "--parent=bot",
    ]);
    expect(fake.calls.every((call) => call.binary === "/opt/dida")).toBe(true);
  });

  it("returns an empty search when dida reports a server error", async () => {
    const fake = scripted(
      () => ({
        stdout: "",
        stderr: "DIDA API 错误 503: upstream",
        code: 1,
      }),
    );
    const api = new DidaCliClient({ run: fake.run });
    await expect(api.searchUnfinished("@bot")).resolves.toEqual([]);
  });

  it("tells the operator to log in without echoing a token", async () => {
    const fake = scripted(
      () => ({
        stdout: "",
        stderr:
          "未找到 access token。请先运行 `dida auth login` 登录。 access_token=super-secret-token-value",
        code: 1,
      }),
    );
    const api = new DidaCliClient({ run: fake.run });
    await expect(api.listInbox()).rejects.toThrow(/dida auth login/);
    try {
      await api.listInbox();
    } catch (error) {
      expect(error).toBeInstanceOf(DidaApiError);
      expect((error as Error).message).not.toContain("super-secret-token-value");
    }
  });

  it("reports a missing dida binary", async () => {
    const api = new DidaCliClient({
      binary: "dida-not-installed-setup-bot",
    });
    await expect(api.listInbox()).rejects.toThrow(/找不到 dida 命令/);
  });

  it("maps an existing-tag failure to HTTP 400", async () => {
    const fake = scripted(
      () => ({
        stdout: "",
        stderr: "DIDA API 错误 400: tag exists",
        code: 1,
      }),
    );
    const api = new DidaCliClient({ run: fake.run });
    await expect(
      api.createTag({ name: "todo", label: "todo" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
