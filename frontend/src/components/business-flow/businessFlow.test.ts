import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assignColumns, businessFlowToSvg, layoutBusinessFlow, nextStepId, removeStep, renameBusinessFlowRefs, validateBusinessFlow, wrapLabel,
  type BusinessFlow,
} from "@harmony/shared";

const flow = (over: Partial<BusinessFlow> = {}): BusinessFlow => ({
  version: 1, id: "f", name: "テスト",
  lanes: [{ id: "a", name: "顧客", kind: "external" }, { id: "b", name: "店舗" }],
  steps: [
    { id: "s", lane: "a", kind: "start", name: "開始", next: [{ to: "t" }] },
    { id: "t", lane: "b", kind: "task", name: "作業", screenRef: "scr", next: [{ to: "d" }] },
    { id: "d", lane: "b", kind: "decision", name: "判断", next: [{ to: "e", label: "OK" }, { to: "t", label: "やり直し" }] },
    { id: "e", lane: "a", kind: "end", name: "終了" },
  ],
  ...over,
});
const codes = (f: BusinessFlow, refs = {}) => validateBusinessFlow(f, refs).map((i) => i.code);

describe("業務フローの検証", () => {
  it("整ったフローは問題なし", () => { expect(codes(flow())).toEqual([]); });
  it("重複・存在しないレーン・存在しない次の工程は error", () => {
    const f = flow({ steps: [...flow().steps, { id: "t", lane: "zzz", kind: "task", name: "重複", next: [{ to: "nope" }] }] });
    const issues = validateBusinessFlow(f);
    expect(issues.filter((i) => i.severity === "error").map((i) => i.code).sort()).toEqual(["dangling-next", "duplicate-id", "unknown-lane"]);
  });
  it("開始・終了が無い / 到達できない / 行き止まり / 判断の分岐不足", () => {
    const f = flow({ steps: [
      { id: "t", lane: "a", kind: "task", name: "作業", next: [{ to: "d" }] },
      { id: "d", lane: "a", kind: "decision", name: "判断", next: [{ to: "t" }] },
      { id: "x", lane: "b", kind: "task", name: "孤立" },
      { id: "y", lane: "b", kind: "task", name: "孤立2", next: [{ to: "x" }] },
    ] });
    const c = codes(f);
    expect(c).toContain("no-start"); expect(c).toContain("no-end");
    expect(c).toContain("decision-branches"); expect(c).toContain("dead-end");
    // 開始が無いときは、他から入ってこない工程 (y) を開始とみなす。t と d は輪になっていて y からは届かない
    expect(validateBusinessFlow(f).filter((i) => i.code === "unreachable").map((i) => i.stepId).sort()).toEqual(["d", "t"]);
  });
  it("終了に次がある / 条件の無い分岐", () => {
    const f = flow();
    f.steps[3].next = [{ to: "s" }];
    f.steps[2].next = [{ to: "e" }, { to: "t", label: "x" }];
    const c = codes(f);
    expect(c).toContain("end-with-next"); expect(c).toContain("decision-unlabeled");
  });
  it("参照先が無い画面・処理・役割は warning", () => {
    const f = flow(); f.steps[1].processFlowRef = "pf"; f.lanes[1].roleRef = "boss";
    const c = codes(f, { screens: new Set(["other"]), flows: new Set<string>(), roles: new Set(["staff"]) });
    expect(c.sort()).toEqual(["unknown-flow", "unknown-role", "unknown-screen"]);
  });
});

describe("図の自動配置", () => {
  it("開始からの最長経路を列にし、戻る線は深さに数えない", () => {
    const cols = assignColumns(flow());
    expect([...cols.entries()]).toEqual([["s", 0], ["t", 1], ["d", 2], ["e", 3]]);
  });
  it("同じ入力から同じ配置になり、レーンは上から並ぶ", () => {
    const a = layoutBusinessFlow(flow()), b = layoutBusinessFlow(flow());
    expect(a).toEqual(b);
    expect(a.lanes[1].y).toBe(a.lanes[0].y + a.lanes[0].h);
    const t = a.steps.find((p) => p.step.id === "t")!; const s = a.steps.find((p) => p.step.id === "s")!;
    expect(t.x).toBeGreaterThan(s.x);
    expect(t.y).toBeGreaterThanOrEqual(a.lanes[1].y);
  });
  it("同じレーン・同じ列の工程は縦に積み、レーンが伸びる", () => {
    const f = flow({ steps: [
      { id: "s", lane: "a", kind: "start", name: "開始", next: [{ to: "p" }, { to: "q" }] },
      { id: "p", lane: "b", kind: "task", name: "P" }, { id: "q", lane: "b", kind: "task", name: "Q" },
    ] });
    const l = layoutBusinessFlow(f);
    const p = l.steps.find((x) => x.step.id === "p")!, q = l.steps.find((x) => x.step.id === "q")!;
    expect(p.x).toBe(q.x); expect(q.y).toBeGreaterThan(p.y);
    expect(l.lanes[1].h).toBeGreaterThan(l.lanes[0].h);
  });
  it("戻る線は back になる", () => {
    const l = layoutBusinessFlow(flow());
    expect(l.edges.find((e) => e.from === "d" && e.to === "t")?.back).toBe(true);
    expect(l.edges.find((e) => e.from === "s" && e.to === "t")?.back).toBe(false);
  });
  it("開始から到達できない工程は最後の列のあとに並べる", () => {
    const f = flow(); f.steps.push({ id: "z", lane: "a", kind: "task", name: "孤立", next: [] });
    const cols = assignColumns(f);
    expect(cols.get("z")!).toBeGreaterThan(cols.get("e")!);
  });
});

describe("SVG 出力", () => {
  it("工程・レーン・線・条件ラベルを含み、名前をエスケープする", () => {
    const f = flow(); f.steps[1].name = "<b>&作業";
    const svg = businessFlowToSvg(f, { interactive: true, selectedId: "t", showRefs: true });
    expect(svg).toContain('class="bf-svg"');
    expect(svg).toContain('data-testid="bf-step-t"');
    expect(svg).toContain("bf-selected");
    expect(svg).toContain("&lt;b&gt;&amp;作業");
    expect(svg).toContain("やり直し");
    expect(svg).toContain(">画面<");
    expect(svg).not.toContain("<b>&");
  });
  it("文言を幅で折り返し、長いときは省略する", () => {
    expect(wrapLabel("あいうえおかきくけこさしすせそ", 5, 2)).toEqual(["あいうえお", "かきくけ…"]);
    expect(wrapLabel("短い", 8)).toEqual(["短い"]);
  });
});

describe("編集の補助", () => {
  it("工程 ID を重ならないように採る", () => { expect(nextStepId(flow())).toBe("step1"); expect(nextStepId({ steps: [{ id: "step1" } as never] })).toBe("step2"); });
  it("工程を削除すると、1 本線でつながっていた直前の工程は削除した工程の次へつなぎ直す", () => {
    const f = flow({ steps: [
      { id: "s", lane: "a", kind: "start", name: "開始", next: [{ to: "m" }] },
      { id: "m", lane: "a", kind: "task", name: "中間", next: [{ to: "e" }] },
      { id: "e", lane: "a", kind: "end", name: "終了" },
    ] });
    const r = removeStep(f, "m");
    expect(r.steps.map((s) => s.id)).toEqual(["s", "e"]);
    expect(r.steps[0].next).toEqual([{ to: "e" }]);
    expect(validateBusinessFlow(r)).toEqual([]);
  });
  it("分岐の一方を削除したときは、つなぎ直さず分岐から外す", () => {
    const r = removeStep(flow(), "e");
    expect(r.steps.find((s) => s.id === "d")?.next).toEqual([{ to: "t", label: "やり直し" }]);
  });
  it("画面・処理フローの改名を工程の参照に反映する", () => {
    const f = flow();
    expect(renameBusinessFlowRefs(f, "screen", "scr", "scr2")).toBe(true);
    expect(f.steps[1].screenRef).toBe("scr2");
    expect(renameBusinessFlowRefs(f, "processFlow", "none", "x")).toBe(false);
  });
});

describe("retail サンプルの業務フロー", () => {
  const root = path.resolve(__dirname, "../../../../examples/retail/harmony");
  const ids = (d: string) => fs.readdirSync(path.join(root, d)).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""));
  const conv = JSON.parse(fs.readFileSync(path.join(root, "conventions", "catalog.json"), "utf-8"));
  const f = JSON.parse(fs.readFileSync(path.join(root, "business-flows", "order-to-shipment.json"), "utf-8")) as BusinessFlow;
  it("参照先 (画面・処理フロー・役割) がすべて実在し、検証の指摘が無い", () => {
    const issues = validateBusinessFlow(f, { screens: new Set(ids("screens")), flows: new Set(ids("process-flows")), roles: new Set(Object.keys(conv.role)) });
    expect(issues).toEqual([]);
  });
  it("図に配置できる (列は開始から終了まで)", () => {
    const l = layoutBusinessFlow(f);
    expect(l.lanes).toHaveLength(4);
    expect(l.steps).toHaveLength(f.steps.length);
    expect(Math.max(...l.steps.map((p) => p.col))).toBeGreaterThanOrEqual(7);
  });
});
