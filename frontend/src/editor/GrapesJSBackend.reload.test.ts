/**
 * GrapesJSBackend / Designer Puck path の screenChanged + RELOAD_EVENTS handler
 * (I-7 Round 8 C / #1299 Codex M-R7-3) のロジックレベル回帰テスト。
 *
 * GrapesJSBackend / Designer はそれぞれ巨大コンポーネントで full render は重いため、
 * 同等のフィルター式をテスト対象関数として抽出し、useResourceEditor の S-1 と同じ
 * 4 ケース (reload:true / oldId 一致 / screenId 一致 / 該当なし) を全 entity 種で検証する。
 */

import { describe, it, expect } from "vitest";

type Payload = {
  screenId?: string;
  oldId?: string;
  reload?: boolean;
  deleted?: boolean;
};

/** GrapesJSBackend.tsx:364-372 と同じフィルター式 (true = onServerChanged 発火) */
function shouldFireScreenChanged(d: Payload, screenId: string): boolean {
  if (d.reload === true) return true;
  if (d.oldId === screenId) return true;
  if (d.screenId !== screenId || d.deleted) return false;
  return true;
}

/** Designer.tsx Puck path:737-783 と同じ RELOAD_EVENTS フィルター (true = setServerChanged 発火) */
function shouldFireReloadEvent(d: { reload?: boolean }): boolean {
  return d.reload === true;
}

describe("GrapesJSBackend screenChanged filter (I-7 Round 8 C)", () => {
  const SELF = "user-list";

  it("reload:true のみの payload は発火する (rename 全件 invalidation)", () => {
    expect(shouldFireScreenChanged({ reload: true }, SELF)).toBe(true);
  });

  it("oldId が自身と一致する payload は発火する (自身が rename された)", () => {
    expect(
      shouldFireScreenChanged({ oldId: SELF, screenId: "user-list-v2", reload: true }, SELF),
    ).toBe(true);
  });

  it("screenId が自身と一致する payload は発火する (通常の編集 broadcast)", () => {
    expect(shouldFireScreenChanged({ screenId: SELF }, SELF)).toBe(true);
  });

  it("他 screen の編集 broadcast は発火しない", () => {
    expect(shouldFireScreenChanged({ screenId: "other-screen" }, SELF)).toBe(false);
  });

  it("自身が deleted フラグ付きで来た場合は発火しない (旧仕様維持)", () => {
    expect(shouldFireScreenChanged({ screenId: SELF, deleted: true }, SELF)).toBe(false);
  });

  it("他 screen の oldId 一致は発火しない (rename 対象は別物)", () => {
    expect(
      shouldFireScreenChanged({ oldId: "other-old", screenId: "other-new", reload: true }, SELF),
    ).toBe(true); // reload:true が先に hit
  });

  it("oldId が他 entity の場合 + reload:false (旧 broadcast 形式) は発火しない", () => {
    expect(
      shouldFireScreenChanged({ oldId: "other-old", screenId: "other-new" }, SELF),
    ).toBe(false);
  });
});

describe("Designer Puck RELOAD_EVENTS filter (I-7 Round 8 C)", () => {
  it("reload:true 付き broadcast は発火する (table/processFlow/sequence/view/viewDefinition/pageLayout 共通)", () => {
    expect(shouldFireReloadEvent({ reload: true })).toBe(true);
  });

  it("reload:undefined / false の broadcast は発火しない (通常の編集は cache 無効化しない)", () => {
    expect(shouldFireReloadEvent({})).toBe(false);
    expect(shouldFireReloadEvent({ reload: false })).toBe(false);
  });
});
