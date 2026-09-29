import { describe, expect, it } from "vitest";
import {
  createMarkers,
  hasBotLifecycleTag,
  hasFreezeTag,
  isBotLifecycleTag,
  withBotLifecycleTag,
  withFreezeTag,
} from "../src/markers.ts";
import { isBotFragment, isTodoClaimCandidate } from "../src/merge-logic.ts";

const m = createMarkers();

describe("bot lifecycle tag helpers", () => {
  it("treats only todo/doing/done as lifecycle leaves", () => {
    expect(isBotLifecycleTag(m, m.tagTodo)).toBe(true);
    expect(isBotLifecycleTag(m, m.tagDoing)).toBe(true);
    expect(isBotLifecycleTag(m, m.tagDone)).toBe(true);
    expect(isBotLifecycleTag(m, m.tagParent)).toBe(false);
    expect(isBotLifecycleTag(m, m.tagFreeze)).toBe(false);
    expect(isBotLifecycleTag(m, "other-todo")).toBe(false);
    expect(isBotLifecycleTag(m, "lane-doing")).toBe(false);
    expect(m.nestedTags).toEqual(["todo", "doing", "done", "freeze"]);
  });

  it("rewrites to a single lifecycle leaf and keeps unrelated tags", () => {
    expect(
      withBotLifecycleTag(
        m,
        ["urgent", m.tagTodo, m.tagParent],
        m.tagDoing,
      ),
    ).toEqual(["urgent", m.tagParent, m.tagDoing]);
    expect(
      withBotLifecycleTag(
        m,
        [m.tagTodo, m.tagDoing, m.tagDone, "keep"],
        m.tagTodo,
      ),
    ).toEqual(["keep", m.tagTodo]);
  });

  it("preserves freeze when rewriting lifecycle leaves", () => {
    expect(
      withBotLifecycleTag(
        m,
        [m.wechatCaptureTag, m.tagFreeze, m.tagTodo],
        m.tagDoing,
      ),
    ).toEqual([m.wechatCaptureTag, m.tagFreeze, m.tagDoing]);
  });

  it("hasBotLifecycleTag", () => {
    expect(hasBotLifecycleTag(m, undefined)).toBe(false);
    expect(hasBotLifecycleTag(m, [m.tagDoing])).toBe(true);
  });
});

describe("freeze classification tag", () => {
  it("detects and appends freeze", () => {
    expect(hasFreezeTag(m, undefined)).toBe(false);
    expect(hasFreezeTag(m, [m.wechatCaptureTag, m.tagFreeze])).toBe(true);
    expect(withFreezeTag(m, [m.wechatCaptureTag])).toEqual([
      m.wechatCaptureTag,
      m.tagFreeze,
    ]);
  });
});

describe("isTodoClaimCandidate", () => {
  it("claims filter hits with explicit todo", () => {
    expect(isTodoClaimCandidate(undefined, m)).toBe(true);
    expect(isTodoClaimCandidate([m.tagTodo], m)).toBe(true);
    expect(isTodoClaimCandidate([m.tagDoing], m)).toBe(false);
    expect(isTodoClaimCandidate(["other-todo"], m)).toBe(false);
  });
});

describe("configured markers", () => {
  const lane = createMarkers({
    botMarker: "@agent",
    notMarker: "@skip",
    tagParent: "agent",
    tagTodo: "lane-todo",
    tagDoing: "lane-doing",
    tagDone: "lane-done",
    tagFreeze: "lane-freeze",
  });

  it("uses configured markers instead of the defaults", () => {
    expect(lane.botMarker).toBe("@agent");
    expect(lane.notMarker).toBe("@skip");
    expect(lane.tagParent).toBe("agent");
    expect(lane.tagTodo).toBe("lane-todo");
    expect(lane.tagDoing).toBe("lane-doing");
    expect(lane.tagDone).toBe("lane-done");
    expect(lane.tagFreeze).toBe("lane-freeze");
    expect(lane.nestedTags).toEqual([
      "lane-todo",
      "lane-doing",
      "lane-done",
      "lane-freeze",
    ]);
    expect(isBotLifecycleTag(lane, "lane-todo")).toBe(true);
    expect(isBotLifecycleTag(lane, "todo")).toBe(false);
    expect(isTodoClaimCandidate(["lane-todo"], lane)).toBe(true);
    expect(isTodoClaimCandidate(["todo"], lane)).toBe(false);
    expect(hasFreezeTag(lane, ["lane-freeze"])).toBe(true);
    expect(hasFreezeTag(lane, ["freeze"])).toBe(false);
    expect(
      isBotFragment({ title: "@agent summarize", content: "" }, lane),
    ).toBe(true);
    expect(isBotFragment({ title: "@bot summarize", content: "" }, lane)).toBe(
      false,
    );
  });
});
