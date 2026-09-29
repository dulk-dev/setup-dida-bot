import { describe, expect, it } from "vitest";
import {
  APPEND_SEPARATOR,
  createMarkers,
} from "../src/markers.ts";
import {
  appendFragmentContent,
  chooseMergeMain,
  contentAlreadyHasPayload,
  createdTimeSecond,
  daysUntil,
  findDependencyCandidates,
  fragmentPayload,
  isBotFragment,
  isInDependencyWindow,
  parseCreatedTimeMs,
  planFragmentActions,
  rewriteBotTitleToNot,
  shanghaiCalendarDate,
  shouldSkipAutoMerge,
  type MergeTask,
} from "../src/merge-logic.ts";

const m = createMarkers(); // production defaults: @bot / @not / freeze
const BOT = m.botMarker;
const NOT = m.notMarker;
const FREEZE = m.tagFreeze;
const WECHAT = m.wechatCaptureTag;

function task(
  partial: Partial<MergeTask> & Pick<MergeTask, "id">,
): MergeTask {
  return {
    projectId: "inbox",
    title: "",
    content: "",
    createdTime: "2026-09-04T10:11:12+0800",
    status: 0,
    ...partial,
  };
}

function capture(
  partial: Partial<MergeTask> & Pick<MergeTask, "id">,
): MergeTask {
  return task({
    tags: [WECHAT],
    ...partial,
  });
}

describe("createdTimeSecond", () => {
  it("truncates timezone offset to YYYY-MM-DDTHH:MM:SS for display", () => {
    expect(createdTimeSecond("2026-04-07T09:25:00+0800")).toBe(
      "2026-04-07T09:25:00",
    );
  });

  it("drops fractional seconds", () => {
    expect(createdTimeSecond("2026-04-07T09:25:00.123+0000")).toBe(
      "2026-04-07T09:25:00",
    );
  });

  it("handles Z suffix", () => {
    expect(createdTimeSecond("2026-04-07T09:25:00Z")).toBe(
      "2026-04-07T09:25:00",
    );
  });

  it("returns null for missing or malformed values", () => {
    expect(createdTimeSecond(undefined)).toBeNull();
    expect(createdTimeSecond("")).toBeNull();
    expect(createdTimeSecond("not-a-date")).toBeNull();
  });
});

describe("parseCreatedTimeMs", () => {
  it("parses +0800 without a colon as a real instant", () => {
    const ms = parseCreatedTimeMs("2026-09-04T10:11:12+0800");
    expect(ms).toBe(Date.parse("2026-09-04T10:11:12+08:00"));
  });

  it("returns null for missing values", () => {
    expect(parseCreatedTimeMs(undefined)).toBeNull();
    expect(parseCreatedTimeMs("nope")).toBeNull();
  });
});

describe("isInDependencyWindow [T-10s, T+10s]", () => {
  const T = Date.parse("2026-09-04T10:11:12+08:00");

  it("includes the exact anchor T", () => {
    expect(isInDependencyWindow(T, T)).toBe(true);
  });

  it("includes T-BEFORE and T+AFTER bounds", () => {
    expect(
      isInDependencyWindow(T, T - m.dependencyWindowBeforeMs),
    ).toBe(true);
    expect(
      isInDependencyWindow(T, T + m.dependencyWindowAfterMs),
    ).toBe(true);
  });

  it("excludes 1ms outside either bound", () => {
    expect(
      isInDependencyWindow(T, T - m.dependencyWindowBeforeMs - 1),
    ).toBe(false);
    expect(
      isInDependencyWindow(T, T + m.dependencyWindowAfterMs + 1),
    ).toBe(false);
  });
});

describe("isBotFragment with @bot", () => {
  it("requires @bot in the title and empty/null content", () => {
    expect(
      isBotFragment({ title: "forwarded wechat", content: "hello" }, m),
    ).toBe(false);
    expect(isBotFragment({ title: `${BOT} summarize`, content: "" }, m)).toBe(
      true,
    );
    expect(
      isBotFragment({ title: `${BOT} summarize`, content: null }, m),
    ).toBe(true);
  });

  it("never treats @not titles as fragments", () => {
    expect(isBotFragment({ title: `${NOT} summarize`, content: "" }, m)).toBe(
      false,
    );
    expect(
      isBotFragment(
        { title: `pls ${NOT} tidy leftover ${BOT}`, content: "" },
        m,
      ),
    ).toBe(false);
  });

  it("still treats freeze-tagged empty @bot as a fragment", () => {
    expect(
      isBotFragment(
        { title: `${BOT} x`, content: "", tags: [FREEZE] },
        m,
      ),
    ).toBe(true);
  });
});

describe("shouldSkipAutoMerge", () => {
  it("skips @not titles and freeze-tagged fragments", () => {
    expect(shouldSkipAutoMerge({ title: `${NOT} leftover` }, m)).toBe(true);
    expect(
      shouldSkipAutoMerge({ title: `${BOT} x`, tags: [FREEZE] }, m),
    ).toBe(true);
    expect(shouldSkipAutoMerge({ title: `${BOT} x`, tags: [] }, m)).toBe(
      false,
    );
  });
});

describe("rewriteBotTitleToNot", () => {
  it("replaces @bot with @not", () => {
    expect(rewriteBotTitleToNot(`${BOT} 总结这段`, m)).toBe(`${NOT} 总结这段`);
    expect(rewriteBotTitleToNot(`请 ${BOT} 处理`, m)).toBe(`请 ${NOT} 处理`);
    expect(rewriteBotTitleToNot(`${BOT} a ${BOT} b`, m)).toBe(
      `${NOT} a ${NOT} b`,
    );
  });
});

describe("appendFragmentContent", () => {
  it("appends with markdown --- separator", () => {
    const { content, appended } = appendFragmentContent(
      "context body",
      `${BOT} do the thing`,
    );
    expect(appended).toBe(true);
    expect(content).toBe(
      `context body${APPEND_SEPARATOR}${BOT} do the thing`,
    );
  });

  it("is idempotent when the payload is already present", () => {
    const first = appendFragmentContent("ctx", `${BOT} x`).content;
    const second = appendFragmentContent(first, `${BOT} x`);
    expect(second.appended).toBe(false);
    expect(contentAlreadyHasPayload(first, `${BOT} x`)).toBe(true);
  });
});

describe("fragmentPayload / chooseMergeMain", () => {
  it("prefers non-empty content over title", () => {
    expect(
      fragmentPayload(
        task({ id: "1", title: `${BOT} title`, content: `${BOT} body` }),
      ),
    ).toBe(`${BOT} body`);
  });

  it("keeps classic context with substance as main", () => {
    const fragment = task({ id: "frag", title: `${BOT} 总结` });
    const dep = capture({
      id: "ctx",
      title: "微信转发",
      content: "长正文",
    });
    const choice = chooseMergeMain(fragment, dep);
    expect(choice.main.id).toBe("ctx");
    expect(choice.deleteFragment).toBe(true);
    expect(choice.payload).toBe(`${BOT} 总结`);
  });

  it("keeps fragment as main for 来自微信的图片", () => {
    const fragment = task({ id: "frag", title: `${BOT} 看看图` });
    const dep = capture({
      id: "img",
      title: "来自微信的图片",
      content: "",
    });
    const choice = chooseMergeMain(fragment, dep);
    expect(choice.main.id).toBe("frag");
    expect(choice.deleteFragment).toBe(false);
    expect(choice.payload).toBe("来自微信的图片 (taskId: img)");
  });
});

describe("planFragmentActions candidate counts", () => {
  const t0 = "2026-09-04T10:11:12+0800";
  const tPlus5 = "2026-09-04T10:11:17+0800";
  const tPlus11 = "2026-09-04T10:11:23+0800";
  const tMinus4 = "2026-09-04T10:11:08+0800";
  const tMinus11 = "2026-09-04T10:11:01+0800";

  it("count 0 → waiting_deps", () => {
    const fragment = task({
      id: "frag",
      title: `${BOT} x`,
      createdTime: t0,
    });
    const outside = capture({
      id: "late",
      title: "chat",
      content: "body",
      createdTime: tPlus11,
    });
    const { merges, nots, skipped } = planFragmentActions(
      [fragment, outside],
      m,
    );
    expect(merges).toEqual([]);
    expect(nots).toEqual([]);
    expect(skipped).toEqual([{ fragment, reason: "waiting_deps" }]);

    const tooEarly = capture({
      id: "early",
      title: "chat",
      content: "body",
      createdTime: tMinus11,
    });
    expect(planFragmentActions([fragment, tooEarly], m).skipped).toEqual([
      { fragment, reason: "waiting_deps" },
    ]);
  });

  it("count 1 → merge", () => {
    const fragment = task({
      id: "frag",
      title: `${BOT} x`,
      createdTime: t0,
    });
    const ctx = capture({
      id: "ctx",
      title: "chat",
      content: "body",
      createdTime: tPlus5,
    });
    const { merges, nots, skipped } = planFragmentActions(
      [fragment, ctx],
      m,
    );
    expect(nots).toEqual([]);
    expect(skipped).toEqual([]);
    expect(merges).toHaveLength(1);
    expect(merges[0].dep.id).toBe("ctx");

    const early = capture({
      id: "early",
      title: "chat2",
      content: "body",
      createdTime: tMinus4,
    });
    expect(planFragmentActions([fragment, early], m).merges[0]?.dep.id).toBe(
      "early",
    );
  });

  it("count 2+ → @not rewrite", () => {
    const fragment = task({
      id: "frag",
      title: `${BOT} x`,
      createdTime: t0,
    });
    const a = capture({
      id: "a",
      title: "one",
      content: "a",
      createdTime: t0,
    });
    const b = capture({
      id: "b",
      title: "two",
      content: "b",
      createdTime: tPlus5,
    });
    const { merges, nots, skipped } = planFragmentActions(
      [fragment, a, b],
      m,
    );
    expect(merges).toEqual([]);
    expect(skipped).toEqual([]);
    expect(nots.map((n) => n.id)).toEqual(["frag"]);
  });

  it("skips auto-merge when fragment already has freeze", () => {
    const fragment = task({
      id: "frag",
      title: `${BOT} x`,
      createdTime: t0,
      tags: [FREEZE],
    });
    const ctx = capture({
      id: "ctx",
      title: "chat",
      content: "body",
      createdTime: t0,
    });
    const { merges, nots, skipped } = planFragmentActions(
      [fragment, ctx],
      m,
    );
    expect(merges).toEqual([]);
    expect(nots).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("requires same project and 微信采集 tag", () => {
    const fragment = task({ id: "frag", title: `${BOT} x` });
    const otherProject = capture({
      id: "p2",
      projectId: "other",
      title: "chat",
      content: "body",
    });
    const untagged = task({
      id: "plain",
      title: "chat",
      content: "body",
    });
    expect(
      findDependencyCandidates(
        fragment,
        [fragment, otherProject, untagged],
        m,
      ),
    ).toEqual([]);
  });
});

describe("shanghaiCalendarDate / daysUntil", () => {
  it("returns YYYY-MM-DD in Asia/Shanghai", () => {
    const utc = new Date("2026-09-04T16:30:00Z");
    expect(shanghaiCalendarDate(utc)).toBe("2026-09-05");
  });

  it("returns fractional days remaining", () => {
    const now = Date.parse("2026-09-04T00:00:00Z");
    const later = Date.parse("2026-09-18T00:00:00Z");
    expect(daysUntil(later, now)).toBe(14);
  });
});

describe("production marker defaults", () => {
  it("ships @bot / todo / doing / done", () => {
    expect(m.botMarker).toBe("@bot");
    expect(m.notMarker).toBe("@not");
    expect(m.tagTodo).toBe("todo");
    expect(m.tagDoing).toBe("doing");
    expect(m.tagDone).toBe("done");
    expect(m.tagFreeze).toBe("freeze");
    expect(m.tagParent).toBe("bot");
    expect(m.wechatCaptureTag).toBe("微信采集");
  });
});
