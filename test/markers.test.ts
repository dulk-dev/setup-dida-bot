import { describe, expect, it } from "vitest";
import {
  createMarkers,
  hasBotLifecycleTag,
  hasFreezeTag,
  isBotLifecycleTag,
  withBotLifecycleTag,
  withFreezeTag,
} from "../src/markers.ts";
import { isTodoClaimCandidate } from "../src/merge-logic.ts";

const m = createMarkers();

describe("bot lifecycle tag helpers (x-*)", () => {
  it("treats only x-todo/x-doing/x-done as lifecycle leaves", () => {
    expect(isBotLifecycleTag(m, m.tagTodo)).toBe(true);
    expect(isBotLifecycleTag(m, m.tagDoing)).toBe(true);
    expect(isBotLifecycleTag(m, m.tagDone)).toBe(true);
    expect(isBotLifecycleTag(m, m.tagParent)).toBe(false);
    expect(isBotLifecycleTag(m, m.tagFreeze)).toBe(false);
    expect(isBotLifecycleTag(m, "todo")).toBe(false);
    expect(isBotLifecycleTag(m, "doing")).toBe(false);
    expect(m.nestedTags).toEqual(["x-todo", "x-doing", "x-done", "x-freeze"]);
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
  it("detects and appends x-freeze", () => {
    expect(hasFreezeTag(m, undefined)).toBe(false);
    expect(hasFreezeTag(m, [m.wechatCaptureTag, m.tagFreeze])).toBe(true);
    expect(withFreezeTag(m, [m.wechatCaptureTag])).toEqual([
      m.wechatCaptureTag,
      m.tagFreeze,
    ]);
  });
});

describe("isTodoClaimCandidate", () => {
  it("claims filter hits with explicit x-todo", () => {
    expect(isTodoClaimCandidate(undefined, m)).toBe(true);
    expect(isTodoClaimCandidate([m.tagTodo], m)).toBe(true);
    expect(isTodoClaimCandidate([m.tagDoing], m)).toBe(false);
    expect(isTodoClaimCandidate(["todo"], m)).toBe(false);
  });
});
