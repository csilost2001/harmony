import { describe, it, expect } from "vitest";
import type { Step, StepType } from "../types/v3";
import { applyOutline, parseOutline, stepsToOutline } from "./processFlowOutline";

const KINDS: StepType[] = ["validation", "dbAccess", "commonProcess", "compute"];
const s = (id: string, kind: StepType, description: string, extra: object = {}) => ({ id, kind, description, ...extra }) as unknown as Step;

describe("processFlowOutline", () => {
  const steps = [
    s("step-01", "validation", "入力を検証する", { fieldErrorsVar: "fieldErrors", inlineBranch: { ok: [], ng: [] } }),
    s("step-02", "dbAccess", "カートを取得する", { tableId: "cart", operation: "SELECT" }),
  ];

  it("工程を 1 行 1 工程の文字にする (種類の表示名 + 説明 + ^id)", () => {
    expect(stepsToOutline(steps)).toBe("[入力チェック] 入力を検証する ^step-01\n[DBアクセス] カートを取得する ^step-02");
  });

  it("改行・バックスラッシュを含む説明、空の説明も往復できる", () => {
    const tricky = [s("step-01", "compute", "a\nb\\c"), s("step-02", "compute", "")];
    const text = stepsToOutline(tricky);
    expect(text).toBe("[計算/代入] a\\nb\\\\c ^step-01\n[計算/代入] ^step-02");
    const { lines, errors } = parseOutline(text, KINDS);
    expect(errors).toEqual([]);
    expect(lines.map((l) => l.description)).toEqual(["a\nb\\c", ""]);
  });

  it("説明の中の ^ は \\^ と書き、行末の ^id と間違えない。途中の連続空白は詰めない", () => {
    const odd = [s("step-01", "compute", "a  ^b"), s("step-02", "compute", "x ^foo")];
    const text = stepsToOutline(odd);
    expect(text).toBe("[計算/代入] a  \\^b ^step-01\n[計算/代入] x \\^foo ^step-02");
    const { lines, errors } = parseOutline(text, KINDS);
    expect(errors).toEqual([]);
    expect(lines.map((l) => [l.description, l.id])).toEqual([["a  ^b", "step-01"], ["x ^foo", "step-02"]]);
    // 新しい行の説明が「 ^foo」で終わっても (エスケープ済みなら) 既存の id とは解釈されない
    expect(parseOutline("[計算/代入] メモ \\^step-01", KINDS).lines[0]).toMatchObject({ description: "メモ ^step-01", id: null });
  });

  it("書き換えなしなら、元の工程がそのまま (同じ参照) 返る", () => {
    const { lines } = parseOutline(stepsToOutline(steps), KINDS);
    const r = applyOutline(steps, lines, new Set(["step-01", "step-02"]));
    expect(r.steps[0]).toBe(steps[0]);
    expect(r.steps[1]).toBe(steps[1]);
    expect([r.added, r.changed, r.removed.length, r.reordered]).toEqual([0, 0, 0, false]);
  });

  it("説明の変更は、ほかの項目を残して反映する", () => {
    const { lines } = parseOutline("[入力チェック] 入力値を厳密に検証する ^step-01\n[DBアクセス] カートを取得する ^step-02", KINDS);
    const r = applyOutline(steps, lines, new Set(["step-01", "step-02"]));
    expect(r.changed).toBe(1);
    expect(r.steps[0]).toMatchObject({ id: "step-01", description: "入力値を厳密に検証する", fieldErrorsVar: "fieldErrors" });
    expect(r.steps[1]).toBe(steps[1]);
  });

  it("^id の無い行は新しい工程、行の入れ替えは順序の変更、行の削除は削除", () => {
    const { lines } = parseOutline("[DBアクセス] カートを取得する ^step-02\n[共通処理] 在庫を引き当てる", KINDS);
    const r = applyOutline(steps, lines, new Set(["step-01", "step-02"]));
    expect(r.steps.map((x) => x.kind)).toEqual(["dbAccess", "commonProcess"]);
    expect(r.steps[1]).toMatchObject({ description: "在庫を引き当てる" });
    expect(r.steps[1].id).not.toBe("step-01");
    expect(r.steps[1].id).not.toBe("step-02");
    expect(r.added).toBe(1);
    expect(r.removed.map((x) => x.id)).toEqual(["step-01"]);
  });

  it("行の入れ替えだけなら reordered", () => {
    const { lines } = parseOutline("[DBアクセス] カートを取得する ^step-02\n[入力チェック] 入力を検証する ^step-01", KINDS);
    const r = applyOutline(steps, lines, new Set(["step-01", "step-02"]));
    expect(r.reordered).toBe(true);
    expect(r.steps.map((x) => x.id)).toEqual(["step-02", "step-01"]);
  });

  it("同じ ^id の行をコピーすると、2 行目は新しい工程になる", () => {
    const { lines } = parseOutline("[入力チェック] 入力を検証する ^step-01\n[入力チェック] 入力を検証する ^step-01", KINDS);
    const r = applyOutline(steps.slice(0, 1), lines, new Set(["step-01"]));
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0].id).toBe("step-01");
    expect(r.steps[1].id).not.toBe("step-01");
  });

  it("既存の工程の種類は変えられない (無視して知らせる)", () => {
    const { lines } = parseOutline("[共通処理] カートを取得する ^step-02", KINDS);
    const r = applyOutline(steps, lines, new Set(["step-01", "step-02"]));
    expect(r.steps[0].kind).toBe("dbAccess");
    expect(r.kindIgnored).toHaveLength(1);
  });

  it("書式の誤りは行番号つきで知らせ、空行は無視する", () => {
    const { lines, errors } = parseOutline("\n[入力チェック] ok\n説明だけ\n[ほげ] x\n   [DBアクセス] 空白 3 つ\ndbAccess 英名なし\n[dbAccess] 英名は可\n\t[DBアクセス] タブ\n    [DBアクセス] 2 段深い", KINDS);
    expect(lines.map((l) => l.lineNo)).toEqual([2, 7]);
    expect(errors.map((e) => e.lineNo)).toEqual([3, 4, 5, 6, 8, 9]);
  });

  describe("入れ子 (subSteps)", () => {
    const tree = [
      s("step-01", "validation", "入力を検証する"),
      s("step-02", "dbAccess", "カートを取得する", { subSteps: [s("step-03", "compute", "件数を数える", { subSteps: [s("step-04", "compute", "孫")] }), s("step-05", "compute", "合計")] }),
    ];
    const text = "[入力チェック] 入力を検証する ^step-01\n[DBアクセス] カートを取得する ^step-02\n  [計算/代入] 件数を数える ^step-03\n    [計算/代入] 孫 ^step-04\n  [計算/代入] 合計 ^step-05";

    it("字下げ 2 つで、配下の工程を書く (往復で同じ)", () => {
      expect(stepsToOutline(tree)).toBe(text);
      const { lines, errors } = parseOutline(text, KINDS);
      expect(errors).toEqual([]);
      expect(lines.map((l) => l.depth)).toEqual([0, 0, 1, 2, 1]);
      const r = applyOutline(tree, lines, new Set(["step-01", "step-02", "step-03", "step-04", "step-05"]));
      expect(r.steps[1]).toBe(tree[1]); // 変更なしなら、元のオブジェクトのまま
      expect([r.added, r.changed, r.removed.length, r.reordered]).toEqual([0, 0, 0, false]);
    });

    it("字下げを足す = 直前の工程の配下へ入れる (入れ子の位置の変更)", () => {
      const flat = "[入力チェック] 入力を検証する ^step-01\n  [DBアクセス] カートを取得する ^step-02";
      const flatSteps = [s("step-01", "validation", "入力を検証する"), s("step-02", "dbAccess", "カートを取得する")];
      const r = applyOutline(flatSteps, parseOutline(flat, KINDS).lines, new Set(["step-01", "step-02"]));
      expect(r.reordered).toBe(true);
      expect(r.steps).toHaveLength(1);
      expect(r.steps[0].subSteps?.map((x) => x.id)).toEqual(["step-02"]);
      expect(r.changed).toBe(0);
    });

    it("子の行を消すと、その工程が消える。親だけ説明を変えても、子はそのまま", () => {
      const lines = parseOutline("[入力チェック] 入力を検証する ^step-01\n[DBアクセス] 取得 ^step-02\n  [計算/代入] 件数を数える ^step-03\n    [計算/代入] 孫 ^step-04", KINDS).lines;
      const r = applyOutline(tree, lines, new Set(["step-01", "step-02", "step-03", "step-04", "step-05"]));
      expect(r.removed.map((x) => x.id)).toEqual(["step-05"]);
      expect(r.changed).toBe(1);
      expect(r.steps[1].subSteps).toHaveLength(1);
      expect(r.steps[1].subSteps![0]).toBe(tree[1].subSteps![0]);
    });

    it("字下げした新しい行は、親の配下の新しい工程になる", () => {
      const lines = parseOutline("[入力チェック] 入力を検証する ^step-01\n  [共通処理] 新しい子", KINDS).lines;
      const r = applyOutline([tree[0]], lines, new Set(["step-01"]));
      expect(r.added).toBe(1);
      expect(r.steps[0].subSteps).toHaveLength(1);
      expect(r.steps[0].subSteps![0]).toMatchObject({ kind: "commonProcess", description: "新しい子" });
    });
  });
});
