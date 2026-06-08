/**
 * GrapesJSBackend / Designer Puck path の screenChanged + RELOAD_EVENTS handler
 * (I-7 Round 8 C / #1299 Codex M-R7-3) のロジックレベル回帰テスト。
 *
 * GrapesJSBackend / Designer が利用する production filter helper を直接テストし、
 * useResourceEditor の S-1 と同じ 4 ケースを検証する。
 */

import { describe, it, expect } from "vitest";
import {
  DESIGNER_REFERENCE_RELOAD_EVENTS,
  isReloadBroadcast,
  shouldNotifyDesignerScreenChanged,
  shouldNotifyScreenChanged,
} from "./reloadEvents";

describe("GrapesJSBackend screenChanged filter (I-7 Round 8 C)", () => {
  const SELF = "user-list";

  it("reload:true のみの payload は発火する (rename 全件 invalidation)", () => {
    expect(shouldNotifyScreenChanged({ reload: true }, SELF)).toBe(true);
  });

  it("oldId が自身と一致する payload は発火する (自身が rename された)", () => {
    expect(
      shouldNotifyScreenChanged({ oldId: SELF, screenId: "user-list-v2", reload: true }, SELF),
    ).toBe(true);
  });

  it("screenId が自身と一致する payload は発火する (通常の編集 broadcast)", () => {
    expect(shouldNotifyScreenChanged({ screenId: SELF }, SELF)).toBe(true);
  });

  it("他 screen の編集 broadcast は発火しない", () => {
    expect(shouldNotifyScreenChanged({ screenId: "other-screen" }, SELF)).toBe(false);
  });

  it("自身が deleted フラグ付きで来た場合は発火しない (旧仕様維持)", () => {
    expect(shouldNotifyScreenChanged({ screenId: SELF, deleted: true }, SELF)).toBe(false);
  });

  it("他 screen の rename payload でも reload:true があれば発火する (全件 invalidation)", () => {
    expect(
      shouldNotifyScreenChanged({ oldId: "other-old", screenId: "other-new", reload: true }, SELF),
    ).toBe(true);
  });

  it("oldId が他 entity の場合 + reload:false (旧 broadcast 形式) は発火しない", () => {
    expect(
      shouldNotifyScreenChanged({ oldId: "other-old", screenId: "other-new" }, SELF),
    ).toBe(false);
  });

  it("payload が欠落しても発火せず例外にしない", () => {
    expect(shouldNotifyScreenChanged(undefined, SELF)).toBe(false);
  });
});

describe("Designer Puck RELOAD_EVENTS filter (I-7 Round 8 C)", () => {
  it("reload:true 付き broadcast は発火する (table/processFlow/sequence/view/viewDefinition/pageLayout 共通)", () => {
    expect(DESIGNER_REFERENCE_RELOAD_EVENTS).toHaveLength(6);
    expect(isReloadBroadcast({ reload: true })).toBe(true);
  });

  it("reload:undefined / false の broadcast は発火しない (通常の編集は cache 無効化しない)", () => {
    expect(isReloadBroadcast({})).toBe(false);
    expect(isReloadBroadcast({ reload: false })).toBe(false);
    expect(isReloadBroadcast(undefined)).toBe(false);
  });

  it("PageLayout resource では screenChanged reload:true を無視する (#1459 review follow-up)", () => {
    expect(shouldNotifyDesignerScreenChanged("pageLayout", { reload: true }, "page-layout:main-layout")).toBe(false);
  });

  it("Screen resource では screenChanged reload:true を扱う", () => {
    expect(shouldNotifyDesignerScreenChanged("screen", { reload: true }, "user-list")).toBe(true);
  });
});
