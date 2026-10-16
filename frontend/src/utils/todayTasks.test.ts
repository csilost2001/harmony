import { describe, it, expect } from "vitest";
import type { DocIssue } from "@harmony/shared";
import { buildTodayTasks } from "./todayTasks";
import type { MarkerItem } from "./markerOverview";

const marker = (id: string, createdAt: string, resolved = false): MarkerItem => ({
  entityType: "table", entityId: "orders", entityName: "受注",
  marker: { id, kind: "todo", body: `内容 ${id}`, author: "human", createdAt, ...(resolved ? { resolvedAt: "2026-01-01T00:00:00Z" } : {}) } as unknown as MarkerItem["marker"],
});
const issue = (severity: DocIssue["severity"], section: string, ref?: DocIssue["ref"]): DocIssue => ({ severity, section, message: `${section} の指摘`, ...(ref ? { ref } : {}) });

describe("buildTodayTasks (続編 第 6 弾 #116)", () => {
  it("下書き → エラー → マーカー (古い順) → 警告 の順に並ぶ", () => {
    const t = buildTodayTasks({
      drafts: [{ kind: "table", id: "orders", key: "draft-table-orders", size: 10 }],
      issues: [issue("warning", "W1"), issue("error", "E1", { kind: "table", id: "orders" }), issue("info", "I1")],
      markers: [marker("m2", "2026-02-02T00:00:00Z"), marker("m1", "2026-01-01T00:00:00Z"), marker("m3", "2026-03-03T00:00:00Z", true)],
    });
    expect(t.map((x) => x.kind)).toEqual(["draft", "error", "marker", "marker", "warning"]);
    expect(t[2].title).toBe("内容 m1");
    expect(t[0].route).toBe("/table/edit/orders");
    expect(t[1].route).toBe("/table/edit/orders");
    expect(t[2].route).toBe("/table/edit/orders");
  });
  it("解決済みのマーカー・情報の指摘は含めない / 件数の上限", () => {
    const many = Array.from({ length: 50 }, (_, i) => marker(`m${i}`, `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`));
    expect(buildTodayTasks({ drafts: [], issues: [issue("info", "I")], markers: [marker("r", "2026-01-01T00:00:00Z", true)] })).toEqual([]);
    expect(buildTodayTasks({ drafts: [], issues: [], markers: many })).toHaveLength(30);
    expect(buildTodayTasks({ drafts: [], issues: [], markers: many }, 5)).toHaveLength(5);
  });
  it("開き先が分からない指摘・種類不明の下書きは route が null", () => {
    const t = buildTodayTasks({ drafts: [{ kind: "zzz", id: "x", key: "draft-zzz-x", size: 1 }], issues: [issue("error", "全体")], markers: [] });
    expect(t.map((x) => x.route)).toEqual([null, null]);
  });

  it("今日の印のあるメモを、下書きの次・エラーの前に出す (印の無いメモは出さない)", () => {
    const t = buildTodayTasks({
      drafts: [{ kind: "table", id: "orders", key: "draft-table-orders", size: 10 }],
      issues: [issue("error", "E1", { kind: "table", id: "orders" })], markers: [],
      notes: { "table:orders": { text: "桁数を確認する", today: true, at: "2026-10-17T00:00:00Z" }, "table:other": { text: "印なし", today: false, at: "2026-10-17T00:00:00Z" } },
    });
    expect(t.map((x) => x.kind)).toEqual(["draft", "note", "error"]);
    expect(t[1]).toMatchObject({ title: "桁数を確認する", detail: "テーブル「orders」のメモ", route: "/table/edit/orders" });
  });
});
