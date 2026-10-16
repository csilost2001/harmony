import { describe, it, expect } from "vitest";
import { breadcrumbFor } from "./breadcrumb";
import type { TabType } from "../store/tabStore";

describe("breadcrumbFor (続編 第 6 弾 #108)", () => {
  it("設計 1 件のタブは [区分, 一覧, 設計名]。一覧は押すと開ける", () => {
    const c = breadcrumbFor({ type: "table", label: "顧客" })!;
    expect(c.map((x) => x.label)).toEqual(["データ", "テーブル一覧", "顧客"]);
    expect(c[0].open).toBeUndefined();
    expect(c[1].open).toEqual({ type: "table-list", resourceId: "main", label: "テーブル一覧" });
    expect(c[2].open).toBeUndefined();
  });
  it("一覧・図のタブは [区分, 画面名]", () => {
    expect(breadcrumbFor({ type: "er", label: "ER 図" })!.map((x) => x.label)).toEqual(["データ", "ER 図"]);
    expect(breadcrumbFor({ type: "process-flow-list", label: "x" })!.map((x) => x.label)).toEqual(["処理", "処理フロー一覧"]);
  });
  it("ダッシュボード・ワークスペース・タブ無しは出さない", () => {
    expect(breadcrumbFor({ type: "dashboard", label: "ダッシュボード" })).toBeNull();
    expect(breadcrumbFor({ type: "workspace-list", label: "w" })).toBeNull();
    expect(breadcrumbFor(undefined)).toBeNull();
  });
  it("設計 1 件を開く種類は、すべて一覧へ戻れる", () => {
    const resource: TabType[] = ["design", "screen-items", "page-layout", "process-flow", "business-flow", "report", "table", "sequence", "view", "view-definition", "generic-definition"];
    for (const type of resource) {
      const c = breadcrumbFor({ type, label: "x" })!;
      expect(c, type).toHaveLength(3);
      expect(c[1].open?.resourceId, type).toBe("main");
    }
  });
});
