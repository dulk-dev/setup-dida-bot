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
    expect(isBotLifecycleTag(m, "x-todo")).toBe(false);
    expect(isBotLifecycleTag(m, "x-doing")).toBe(false);
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
    expect(isTodoClaimCandidate(["x-todo"], m)).toBe(false);
  });
});

describe("configured markers", () => {
  const lane = createMarkers({
    botMarker: "@botx",
    notMarker: "@notx",
    tagParent: "x-bot",
    tagTodo: "x-todo",
    tagDoing: "x-doing",
    tagDone: "x-done",
    tagFreeze: "x-freeze",
  });

  it("uses the configured markers instead of production defaults", () => {
    expect(lane.botMarker).toBe("@botx");
    expect(lane.notMarker).toBe("@notx");
    expect(lane.tagParent).toBe("x-bot");
    expect(lane.tagTodo).toBe("x-todo");
    expect(lane.tagDoing).toBe("x-doing");
    expect(lane.tagDone).toBe("x-done");
    expect(lane.tagFreeze).toBe("x-freeze");
    expect(lane.nestedTags).toEqual(["x-todo", "x-doing", "x-done", "x-freeze"]);
    expect(isBotLifecycleTag(lane, "x-todo")).toBe(true);
    expect(isBotLifecycleTag(lane, "todo")).toBe(false);
    expect(isTodoClaimCandidate(["x-todo"], lane)).toBe(true);
    expect(isTodoClaimCandidate(["todo"], lane)).toBe(false);
    expect(hasFreezeTag(lane, ["x-freeze"])).toBe(true);
    expect(hasFreezeTag(lane, ["freeze"])).toBe(false);
    expect(
      isBotFragment({ title: "@botx summarize", content: "" }, lane),
    ).toBe(true);
    expect(isBotFragment({ title: "@bot summarize", content: "" }, lane)).toBe(
      false,
    );
  });
});
