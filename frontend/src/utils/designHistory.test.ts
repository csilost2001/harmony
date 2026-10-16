import { describe, it, expect } from "vitest";
import type { AuditEntry } from "./opsApi";
import { actionVerb, designTimeline, entryDesign, lastEditIndex, lastEditOf } from "./designHistory";

const e = (at: string, actor: string, action: string, target?: string, via?: AuditEntry["via"]): AuditEntry => ({ at, actor, action, ...(target ? { target } : {}), ...(via ? { via } : {}) });
// 新しい順
const log: AuditEntry[] = [
  e("2026-10-17T10:00:00Z", "花子", "編集内容を保存した", "table orders"),
  e("2026-10-17T09:00:00Z", "AI", "テーブルを保存した", "orders", "ai"),
  e("2026-10-16T09:00:00Z", "太郎", "画面を保存した", "orders"),
  e("2026-10-16T08:00:00Z", "太郎", "承認の状態を「承認待ち」にした", "orders"),
  e("2026-10-15T08:00:00Z", "次郎", "編集内容を保存した", "screen-item cart"),
  e("2026-10-15T07:00:00Z", "次郎", "プロジェクトの設定・一覧を保存した"),
];

describe("entryDesign", () => {
  it("編集セッションの対象 (種類 id) と、動作の文言から、設計の種類と id を読む", () => {
    expect(entryDesign(log[0])).toEqual({ kind: "table", id: "orders" });
    expect(entryDesign(log[1])).toEqual({ kind: "table", id: "orders" });
    expect(entryDesign(log[2])).toEqual({ kind: "screen", id: "orders" });
    expect(entryDesign(log[4])).toEqual({ kind: "screen", id: "cart" });
    expect(entryDesign(log[5])).toBeNull();
  });
});

describe("designTimeline / lastEditOf", () => {
  it("同じ id でも、種類が違う記録は混ぜない。承認などの変更でない動作は含めない", () => {
    expect(designTimeline(log, "table", "orders").map((x) => x.actor)).toEqual(["花子", "AI"]);
    expect(designTimeline(log, "screen", "orders").map((x) => x.actor)).toEqual(["太郎"]);
  });
  it("最終編集は、いちばん新しい変更", () => {
    expect(lastEditOf(log, "table", "orders")).toEqual({ actor: "花子", at: "2026-10-17T10:00:00Z", via: undefined });
    expect(lastEditOf(log, "table", "none")).toBeNull();
  });
});

describe("lastEditIndex", () => {
  it("設計ごとの最終編集を 1 回で引ける", () => {
    const m = lastEditIndex(log);
    expect(m.get("table:orders")?.actor).toBe("花子");
    expect(m.get("screen:orders")?.actor).toBe("太郎");
    expect(m.get("screen:cart")?.actor).toBe("次郎");
    expect(m.size).toBe(3);
  });
});

describe("actionVerb", () => {
  it("保存・削除・改名", () => {
    expect(actionVerb("テーブルを削除した")).toBe("削除");
    expect(actionVerb("編集内容を保存した")).toBe("保存");
    expect(actionVerb("設計の id を改名した")).toBe("改名");
  });
});

import { designOfTab } from "./designHistory";
describe("designOfTab", () => {
  it("設計のタブから、種類・版の種類・読み出しを引く。一覧のタブは null", () => {
    expect(designOfTab("table", "orders")).toMatchObject({ kind: "table", id: "orders", versionType: "table", opsKind: "table", load: { method: "loadTable", key: "tableId" } });
    expect(designOfTab("screen-items", "cart")).toMatchObject({ kind: "screen", versionType: null });
    expect(designOfTab("page-layout", "pl1")).toMatchObject({ kind: "pageLayout", versionType: "page-layout", opsKind: null });
    expect(designOfTab("table-list", "main")).toBeNull();
    expect(designOfTab(undefined, "x")).toBeNull();
  });
});

import { revisionDraftText } from "./designHistory";
describe("revisionDraftText", () => {
  it("更新された設計に、期間内に変更した人を添える。記録が無ければ人は付けない", () => {
    const items = [{ kind: "table" as const, id: "orders", name: "注文", saves: 3 }, { kind: "processFlow" as const, id: "f1", name: "確定", saves: 1 }];
    const text = revisionDraftText(items, log, "2026-10-16T00:00:00Z");
    expect(text.split("\n")).toEqual(["テーブル「注文」を更新 (3 回、花子・AI)", "処理フロー「確定」を更新 (1 回)"]);
    // 期間より前の記録は数えない
    expect(revisionDraftText(items.slice(0, 1), log, "2026-10-17T09:30:00Z")).toBe("テーブル「注文」を更新 (3 回、花子)");
  });
});
