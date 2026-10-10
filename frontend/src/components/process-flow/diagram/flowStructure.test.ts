import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ProcessFlow, ActionDefinition } from "../../../types/v3";
import { buildOutline, layoutFlow, stepTarget, returnStatus } from "./flowStructure";

const flow = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../examples/retail/harmony/process-flows/order-confirm.json"), "utf-8")) as ProcessFlow;
const action = flow.actions[0] as ActionDefinition;
const ctx = { tableName: (id: string) => ({ order: "注文", cart: "カート" } as Record<string, string>)[id], screenName: () => undefined };

describe("処理記述表 (buildOutline)", () => {
  const rows = buildOutline(action.steps, action, ctx);

  it("階層番号を振る (TX 内は 8-1、分岐の枝は 4-A / 4-A-1)", () => {
    const nos = rows.map((r) => r.no);
    expect(nos.slice(0, 3)).toEqual(["1", "2", "3"]);
    expect(nos).toContain("4-A");
    expect(nos).toContain("4-A-1");
    expect(rows.find((r) => r.step?.kind === "transactionScope")).toBeTruthy();
  });

  it("TX 内の行に印を付け、4xx を返す行を異常終了とする", () => {
    const tx = rows.find((r) => r.step?.kind === "transactionScope")!;
    // TX 本体の行は inTx、ロールバック時 / コミット後 (n-R / n-C) の行は TX の外
    const inner = rows.filter((r) => r.no.startsWith(`${tx.no}-`) && r.type === "step");
    expect(inner.filter((r) => !/^\d+-[RC]/.test(r.no)).every((r) => r.inTx)).toBe(true);
    expect(inner.filter((r) => /^\d+-R/.test(r.no)).every((r) => !r.inTx)).toBe(true);
    expect(rows.some((r) => r.type === "branch-arm" && r.text === "ロールバック時")).toBe(true);
    expect(rows.filter((r) => r.isError).length).toBeGreaterThanOrEqual(3);
  });

  it("対象列: DB アクセスはテーブル表示名 + 操作", () => {
    const db = rows.find((r) => r.step?.kind === "dbAccess" && (r.step as { tableId?: string }).tableId === "cart")!;
    expect(db.target).toMatch(/^カート /);
  });
});

describe("フローチャート (layoutFlow)", () => {
  const lay = layoutFlow(action, ctx);

  it("全ステップ (入れ子含む) が図のノードか枠になる", () => {
    const ids = new Set([...lay.nodes.map((n) => n.stepId), ...lay.frames.map((f) => f.stepId)].filter(Boolean));
    const all: string[] = [];
    const walk = (steps: unknown[]) => steps.forEach((s) => {
      const st = s as { id: string; steps?: unknown[]; branches?: Array<{ steps: unknown[] }>; elseBranch?: { steps: unknown[] }; onCommit?: unknown[]; onRollback?: unknown[] };
      all.push(st.id);
      walk(st.steps ?? []); (st.branches ?? []).forEach((b) => walk(b.steps)); walk(st.elseBranch?.steps ?? []); walk(st.onCommit ?? []); walk(st.onRollback ?? []);
    });
    walk(action.steps);
    for (const id of all) expect(ids.has(id), `step ${id}`).toBe(true);
  });

  it("分岐はひし形、TX とループは枠、異常系 return は error の端子", () => {
    expect(lay.nodes.some((n) => n.shape === "diamond")).toBe(true);
    expect(lay.frames.some((f) => f.kind === "tx")).toBe(true);
    expect(lay.frames.some((f) => f.kind === "loop")).toBe(true);
    expect(lay.nodes.filter((n) => n.tone === "error").length).toBeGreaterThanOrEqual(3);
  });

  it("ノード同士が重ならない", () => {
    const ns = lay.nodes;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i], b = ns[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.text} / ${b.text}`).toBe(false);
    }
  });

  it("図の大きさがノードを包含する", () => {
    for (const n of lay.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(lay.width);
      expect(n.y + n.h).toBeLessThanOrEqual(lay.height);
    }
  });

  it("終了ノードの本文にステータスを重ねて書かない", () => {
    for (const n of lay.nodes.filter((x) => x.caption.startsWith("HTTP "))) {
      expect(n.text.startsWith(n.caption.slice(5))).toBe(false);
    }
  });

  it("ステップが空なら開始のみ", () => {
    const l = layoutFlow({ name: "空", trigger: "submit", steps: [] } as unknown as ActionDefinition);
    expect(l.nodes.map((n) => n.id)).toEqual(["start"]);
  });
});

describe("補助関数", () => {
  it("returnStatus は応答定義の status、無ければ responseId の先頭 3 桁", () => {
    const step = { id: "r", kind: "return", description: "", responseId: "422-x" } as never;
    expect(returnStatus(step, { responses: [] })).toBe(422);
    expect(returnStatus(step, { responses: [{ id: "422-x", status: 409 }] as never })).toBe(409);
  });
  it("stepTarget は画面遷移で画面名", () => {
    expect(stepTarget({ id: "s", kind: "screenTransition", description: "", targetScreenId: "cart" } as never, { tableName: () => undefined, screenName: () => "カート" })).toBe("カート");
  });
});

describe("テスト観点 (deriveTestViewpoints)", () => {
  // shared の関数を直接使う (v3 型ラッパーは不要)
  it("注文確定: 正常系 1 件を先頭に、入力チェック・カート空・TX 失敗の異常系を列挙する", async () => {
    const { deriveTestViewpoints } = await import("@harmony/shared");
    const vs = deriveTestViewpoints(action as never);
    expect(vs[0]).toMatchObject({ no: 1, category: "正常系", status: 200 });
    const errors = vs.filter((v) => v.category === "異常系");
    expect(errors.some((v) => v.status === 400)).toBe(true);
    expect(errors.some((v) => v.conditions.some((c) => c.includes("カート空")) && v.status === 422)).toBe(true);
    expect(errors.some((v) => v.conditions.some((c) => c.includes("在庫不足")))).toBe(true);
    // 終了ステップの No は処理記述表と同じ番号体系
    expect(errors.find((v) => v.conditions.some((c) => c.includes("カート空")))?.stepNo).toBe("4-A-1");
    // 期待結果にステータスを重ねて書かない (「HTTP 422 422 …」にしない)
    expect(vs.every((v) => !/HTTP (\d{3}) \1/.test(v.expected))).toBe(true);
  });

  it("return の無いフローは最後まで到達して正常終了", async () => {
    const { deriveTestViewpoints } = await import("@harmony/shared");
    const vs = deriveTestViewpoints({ steps: [{ id: "a", kind: "compute", description: "計算" }] });
    expect(vs).toEqual([expect.objectContaining({ category: "正常系", expected: "最後まで処理して正常終了" })]);
  });
});
