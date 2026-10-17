import { describe, it, expect, beforeEach } from "vitest";
import { WALKTHROUGH_STEPS, loadWalkthroughDone, nextStep, saveWalkthroughDone } from "./guidedWalkthrough";

beforeEach(() => localStorage.clear());

/** アプリの経路 (AppShell の Routes。ワークスペースの下) */
const KNOWN_ROUTES = ["/table/list", "/screen/list", "/process-flow/list", "/analysis", "/document", "/operations", "/business-flow/list", "/report/list"];

describe("guidedWalkthrough (続編 第 10 弾 #199)", () => {
  it("手順の id は重ならず、すべて、開く画面・手順・確かめ方を持つ", () => {
    const ids = WALKTHROUGH_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of WALKTHROUGH_STEPS) {
      expect(s.title && s.what && s.check && s.routeLabel).toBeTruthy();
      expect(s.how.length).toBeGreaterThan(0);
    }
  });
  it("開く画面は、アプリにある経路だけ", () => {
    expect(WALKTHROUGH_STEPS.filter((s) => !KNOWN_ROUTES.includes(s.route)).map((s) => s.id)).toEqual([]);
  });
  it("カラムの例は、タブ区切りで、行ごとに列の数がそろっている", () => {
    const tsv = WALKTHROUGH_STEPS.find((s) => s.id === "table")!.sample!.text.split("\n");
    expect(new Set(tsv.map((l) => l.split("\t").length)).size).toBe(1);
    expect(tsv[0]).toContain("物理名");
  });
  it("進み具合を、ワークスペースごとに覚える。知らない手順の id は捨てる", () => {
    saveWalkthroughDone("a", new Set(["table", "screen"]));
    expect([...loadWalkthroughDone("a")].sort()).toEqual(["screen", "table"]);
    expect(loadWalkthroughDone("b").size).toBe(0);
    localStorage.setItem("harmony.walkthrough:a", JSON.stringify(["table", "zzz", 3]));
    expect([...loadWalkthroughDone("a")]).toEqual(["table"]);
    localStorage.setItem("harmony.walkthrough:a", "{broken");
    expect(loadWalkthroughDone("a").size).toBe(0);
  });
  it("次の手順は、終えていない最初のもの", () => {
    expect(nextStep(new Set())?.id).toBe("table");
    expect(nextStep(new Set(["table", "screen"]))?.id).toBe("items");
    expect(nextStep(new Set(WALKTHROUGH_STEPS.map((s) => s.id)))).toBeNull();
  });
});

import { parseColumnTable } from "./columnPaste";
describe("通しの案内のカラムの例は、実際の「表から貼り付け」で読める", () => {
  it("4 つのカラムとして読め、主キー・必須・型・長さが入る", () => {
    const r = parseColumnTable(WALKTHROUGH_STEPS.find((s) => s.id === "table")!.sample!.text);
    expect(r.columns.map((c) => c.physicalName)).toEqual(["id", "customer_name", "ordered_on", "total_amount"]);
    expect(r.columns[0]).toMatchObject({ dataType: "BIGINT", primaryKey: true });
    expect(r.columns[1]).toMatchObject({ dataType: "VARCHAR", length: 40, notNull: true });
    expect(r.columns[3]).toMatchObject({ dataType: "DECIMAL", length: 12 });
  });
});
