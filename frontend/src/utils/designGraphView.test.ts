import { describe, it, expect } from "vitest";
import { buildDesignGraph, type DesignDocInput } from "@harmony/shared";
import { buildGraphElements, DEFAULT_HIDDEN_KINDS } from "./designGraphView";

const input = {
  project: { id: "p", name: "P" },
  screens: [{ id: "s1", name: "受注画面", items: [] }],
  flows: [{ meta: { id: "f1", name: "受注登録", screenId: "s1" }, actions: [{ id: "a", name: "登録", steps: [{ id: "x", kind: "dbAccess", tableId: "t1", operation: "INSERT" }] }] }],
  tables: [{ id: "t1", name: "受注", physicalName: "orders", columns: [] }],
} as unknown as DesignDocInput;

describe("buildGraphElements (続編 第 7 弾 #132)", () => {
  const g = buildDesignGraph(input);
  const els = buildGraphElements(g);
  it("ノードと線を作り、種類ごとの件数と線の種類を返す", () => {
    expect(els.nodes.map((n) => n.id).sort()).toEqual(["processFlow:f1", "screen:s1", "table:t1"].sort());
    expect(els.kindCounts.map((k) => `${k.label}:${k.count}`).sort()).toEqual(["テーブル:1", "処理フロー:1", "画面:1"].sort());
    expect(els.edges.some((e) => e.source === "processFlow:f1" && e.target === "table:t1")).toBe(true);
    expect(els.edgeKinds.length).toBeGreaterThan(0);
    expect(els.nodes.every((n) => n.position && Number.isFinite(n.position.x))).toBe(true);
  });
  it("頼っている側が左、頼られている側が右に並ぶ", () => {
    const x = (k: string) => els.nodes.find((n) => n.id === k)!.position.x;
    expect(x("processFlow:f1")).toBeLessThan(x("table:t1"));
  });
  it("既定で隠す種類は、ノードも線も hidden", () => {
    const withMsg = buildDesignGraph({ ...input, messages: { "E001": { text: "x" } } } as unknown as DesignDocInput);
    const e = buildGraphElements(withMsg, DEFAULT_HIDDEN_KINDS);
    expect(e.nodes.find((n) => n.id === "message:E001")?.hidden ?? true).toBe(true);
    const shown = buildGraphElements(withMsg, []);
    expect(shown.nodes.find((n) => n.id === "message:E001")?.hidden).toBe(false);
  });
});
