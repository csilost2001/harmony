import { describe, it, expect } from "vitest";
import { ageDays, filterMarkerItems, markerEntityRoute, summarizeMarkerItems, DEFAULT_MARKER_FILTER, type MarkerItem } from "./markerOverview";
import type { Marker } from "../types/v3";

const NOW = Date.parse("2026-10-16T00:00:00Z");
const item = (type: MarkerItem["entityType"], id: string, name: string, over: Partial<Marker> = {}): MarkerItem => ({
  entityType: type, entityId: id, entityName: name,
  marker: { id: `${id}-${over.body ?? "m"}` as Marker["id"], kind: "todo", body: "指示", author: "human", createdAt: "2026-10-10T00:00:00Z" as Marker["createdAt"], ...over },
});

describe("markerOverview", () => {
  const items = [
    item("table", "orders", "注文", { body: "金額の列", createdAt: "2026-10-01T00:00:00Z" as Marker["createdAt"] }),
    item("processFlow", "confirm", "注文確定", { body: "SQL を直す", kind: "question", createdAt: "2026-10-05T00:00:00Z" as Marker["createdAt"] }),
    item("table", "customers", "顧客", { body: "済んだもの", resolvedAt: "2026-10-06T00:00:00Z" as Marker["resolvedAt"], resolution: "対応した" }),
    item("screen", "cart", "カート", { body: "ボタン", createdAt: "2026-10-12T00:00:00Z" as Marker["createdAt"] }),
  ];

  it("経路: 画面のマーカーは、画面項目の画面。ID は URL 用に符号化", () => {
    expect(markerEntityRoute("screen", "cart")).toBe("/screen/items/cart");
    expect(markerEntityRoute("table", "orders")).toBe("/table/edit/orders");
    expect(markerEntityRoute("processFlow", "a b")).toBe("/process-flow/edit/a%20b");
    expect(markerEntityRoute("pageLayout", "main")).toBe("/page-layout/edit/main");
  });

  it("絞り込み: 既定は未解決だけ。古いものから並ぶ。種類・語 (本文・設計名・解決メモ)・解決済みも含める", () => {
    expect(filterMarkerItems(items, DEFAULT_MARKER_FILTER).map((i) => i.entityId)).toEqual(["orders", "confirm", "cart"]);
    expect(filterMarkerItems(items, { ...DEFAULT_MARKER_FILTER, entityType: "table" }).map((i) => i.entityId)).toEqual(["orders"]);
    expect(filterMarkerItems(items, { ...DEFAULT_MARKER_FILTER, kind: "question" }).map((i) => i.entityId)).toEqual(["confirm"]);
    expect(filterMarkerItems(items, { ...DEFAULT_MARKER_FILTER, includeResolved: true }).length).toBe(4);
    expect(filterMarkerItems(items, { ...DEFAULT_MARKER_FILTER, includeResolved: true, query: "対応した" }).map((i) => i.entityId)).toEqual(["customers"]);
    expect(filterMarkerItems(items, { ...DEFAULT_MARKER_FILTER, query: "ｓｑｌ" }).map((i) => i.entityId)).toEqual(["confirm"]); // 全角半角・大文字小文字を無視
    expect(filterMarkerItems(items, { ...DEFAULT_MARKER_FILTER, query: "カート" }).map((i) => i.entityId)).toEqual(["cart"]);
  });

  it("経過日数", () => {
    expect(ageDays("2026-10-01T00:00:00Z", NOW)).toBe(15);
    expect(ageDays("2026-10-17T00:00:00Z", NOW)).toBe(0);
    expect(ageDays("不正", NOW)).toBe(0);
  });

  it("ダッシュボードの集計: 未解決だけ。種類別・設計の種類別・設計ごと・いちばん古い日数・新しい順の 5 件", () => {
    const s = summarizeMarkerItems(items, NOW);
    expect(s.total).toBe(3);
    expect(s.byKind).toMatchObject({ todo: 2, question: 1 });
    expect(s.byType).toEqual([{ type: "table", label: "テーブル", count: 1 }, { type: "processFlow", label: "処理フロー", count: 1 }, { type: "screen", label: "画面", count: 1 }].sort((a, b) => b.count - a.count));
    expect(s.perEntity.map((p) => p.id)).toEqual(expect.arrayContaining(["orders", "confirm", "cart"]));
    expect(s.oldestDays).toBe(15);
    expect(s.recent.map((i) => i.entityId)).toEqual(["cart", "confirm", "orders"]);
    expect(summarizeMarkerItems([], NOW)).toMatchObject({ total: 0, oldestDays: 0, recent: [] });
  });
});
