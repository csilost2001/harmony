import { describe, it, expect } from "vitest";
import {
  addMarker, listMarkers, resolveMarker, unresolveMarker, removeMarker, migrateLegacyMarkers, summarizeMarkers,
  stableMarkerId, anchorLabel, anchorPathColumn, anchorPathItem, anchorPathLayoutNode, buildAiPrompt, isUuid, newMarkerId, type MarkerHost,
} from "@harmony/shared";

describe("markers (共通)", () => {
  it("id は UUID。足すと authoring.markers に入り、位置は anchor に入る", () => {
    const doc: MarkerHost = {};
    const m = addMarker(doc, { kind: "todo", body: "金額の列を DECIMAL に", author: "human", fieldPath: anchorPathColumn("col-02") });
    expect(isUuid(m.id)).toBe(true);
    expect(doc.authoring?.markers).toHaveLength(1);
    expect(m.anchor).toEqual({ fieldPath: "$.columns[col-02]" });
    expect((doc as { markers?: unknown }).markers).toBeUndefined(); // 最上位には書かない
    const n = addMarker(doc, { kind: "chat", body: "はい", author: "ai", stepId: "step-1" });
    expect(n.anchor).toEqual({ stepId: "step-1" });
    expect(addMarker(doc, { kind: "chat", body: "x", author: "ai" }).anchor).toBeUndefined();
  });

  it("絞り込み: 未解決・種類・工程・位置の前方一致", () => {
    const doc: MarkerHost = {};
    const a = addMarker(doc, { kind: "todo", body: "a", author: "human", stepId: "s1" });
    addMarker(doc, { kind: "question", body: "b", author: "human", fieldPath: anchorPathItem("email") });
    addMarker(doc, { kind: "todo", body: "c", author: "human", fieldPath: anchorPathItem("name") });
    resolveMarker(doc, a.id, "done");
    expect(listMarkers(doc).length).toBe(3);
    expect(listMarkers(doc, { unresolvedOnly: true }).map((m) => m.body)).toEqual(["b", "c"]);
    expect(listMarkers(doc, { kind: "todo" }).map((m) => m.body)).toEqual(["a", "c"]);
    expect(listMarkers(doc, { stepId: "s1" }).map((m) => m.body)).toEqual(["a"]);
    expect(listMarkers(doc, { fieldPathPrefix: "$.items[" }).map((m) => m.body)).toEqual(["b", "c"]);
  });

  it("解決・解決の取り消し・削除。最後の 1 件を消すと authoring.markers を外し、空の authoring も残さない", () => {
    const doc: MarkerHost = {};
    const a = addMarker(doc, { kind: "todo", body: "a", author: "human" });
    resolveMarker(doc, a.id, "対応した");
    expect(doc.authoring?.markers?.[0]).toMatchObject({ resolution: "対応した" });
    expect(doc.authoring?.markers?.[0].resolvedAt).toBeTruthy();
    unresolveMarker(doc, a.id);
    expect(doc.authoring?.markers?.[0].resolvedAt).toBeUndefined();
    expect(doc.authoring?.markers?.[0].resolution).toBeUndefined();
    removeMarker(doc, a.id);
    expect(doc.authoring).toBeUndefined();
    expect(() => resolveMarker(doc, "none")).toThrow("見つかりません");
    expect(() => removeMarker(doc, "none")).toThrow("見つかりません");
  });

  it("authoring の ほかの欄 (notes など) は、マーカーを全部消しても残る", () => {
    const doc: MarkerHost = { authoring: { notes: [{ id: "n" }] } };
    const a = addMarker(doc, { kind: "chat", body: "a", author: "human" });
    removeMarker(doc, a.id);
    expect(doc.authoring).toEqual({ notes: [{ id: "n" }] });
  });

  it("古い形 (最上位の markers・平らな stepId / fieldPath・mk-… の id) を、authoring.markers へ移す", () => {
    const doc = {
      markers: [
        { id: "mk-123-abc", kind: "todo", body: "SQL を直す", stepId: "step-2", fieldPath: "$.sql", author: "ai", createdAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-02T00:00:00Z", resolution: "済" },
        { id: "mk-9", kind: "weird", body: "x", author: "?" },
        { nobody: true },
      ],
      authoring: { markers: [{ id: "11111111-1111-4111-8111-111111111111", kind: "chat", body: "既存", author: "human", createdAt: "2026-01-01T00:00:00Z" }] },
    } as unknown as MarkerHost;
    expect(migrateLegacyMarkers(doc)).toBeGreaterThan(0);
    expect((doc as { markers?: unknown }).markers).toBeUndefined();
    const list = doc.authoring!.markers!;
    expect(list).toHaveLength(3);
    expect(list.every((m) => isUuid(m.id))).toBe(true);
    const moved = list.find((m) => m.body === "SQL を直す")!;
    expect(moved.anchor).toEqual({ stepId: "step-2", fieldPath: "$.sql" });
    expect(moved).toMatchObject({ author: "ai", resolution: "済", kind: "todo" });
    const weird = list.find((m) => m.body === "x")!;
    expect(weird).toMatchObject({ kind: "chat", author: "human" });
    expect(migrateLegacyMarkers(doc)).toBe(0); // 2 回目は何もしない
  });

  it("古い id からの UUID は、いつも同じ (読むたびに移しても、一覧と解決で id が食い違わない)", () => {
    expect(stableMarkerId("mk-123-abc")).toBe(stableMarkerId("mk-123-abc"));
    expect(stableMarkerId("mk-123-abc")).not.toBe(stableMarkerId("mk-123-abd"));
    expect(isUuid(stableMarkerId("mk-123-abc"))).toBe(true);
    expect(stableMarkerId("11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
    const make = () => ({ markers: [{ id: "mk-1", kind: "todo", body: "x", author: "ai", createdAt: "2026-01-01T00:00:00Z" }] }) as unknown as MarkerHost;
    const a = make(); const b = make();
    migrateLegacyMarkers(a); migrateLegacyMarkers(b);
    expect(a.authoring!.markers![0].id).toBe(b.authoring!.markers![0].id);
  });

  it("件数の集計 (未解決の種類別)", () => {
    const doc: MarkerHost = {};
    const a = addMarker(doc, { kind: "todo", body: "a", author: "human" });
    addMarker(doc, { kind: "question", body: "b", author: "human" });
    addMarker(doc, { kind: "todo", body: "c", author: "human" });
    resolveMarker(doc, a.id);
    expect(summarizeMarkers(doc.authoring!.markers!)).toEqual({ total: 3, unresolved: 2, byKind: { chat: 0, attention: 0, todo: 1, question: 1, validator: 0 } });
  });

  it("anchorLabel", () => {
    expect(anchorLabel(undefined)).toBe("全体");
    expect(anchorLabel({ stepId: "s1" })).toBe("工程 s1");
    expect(anchorLabel({ stepId: "s1", fieldPath: "$.sql" })).toBe("工程 s1 ($.sql)");
    expect(anchorLabel({ fieldPath: anchorPathColumn("c1") })).toBe("カラム c1");
    expect(anchorLabel({ fieldPath: anchorPathItem("email") })).toBe("項目 email");
    expect(anchorLabel({ fieldPath: anchorPathLayoutNode("n1") })).toBe("部品 n1");
    expect(anchorLabel({ fieldPath: "$.other" })).toBe("$.other");
  });

  it("AI に渡す文: 未解決だけ。対象・種類・本文 (複数行) を含み、/designer-work を案内する。無ければ空", () => {
    const doc: MarkerHost = {};
    const a = addMarker(doc, { kind: "todo", body: "1 行目\n2 行目", author: "human", fieldPath: anchorPathColumn("col-02") });
    const b = addMarker(doc, { kind: "question", body: "済んだもの", author: "human" });
    resolveMarker(doc, b.id);
    const text = buildAiPrompt([
      { entityType: "table", entityId: "orders", entityName: "注文", marker: a },
      { entityType: "table", entityId: "orders", marker: doc.authoring!.markers![1] },
    ]);
    expect(text).toContain("1 件");
    expect(text).toContain("/designer-work");
    expect(text).toContain("テーブル 「注文」(orders) の カラム col-02");
    expect(text).toContain("[TODO]");
    expect(text).toContain("1 行目\n   2 行目");
    expect(text).not.toContain("済んだもの");
    expect(buildAiPrompt([])).toBe("");
  });

  it("newMarkerId は、crypto が無くても UUID になる", () => {
    const g = globalThis as { crypto?: unknown };
    const saved = g.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try { expect(isUuid(newMarkerId())).toBe(true); }
    finally { Object.defineProperty(globalThis, "crypto", { value: saved, configurable: true }); }
  });
});
