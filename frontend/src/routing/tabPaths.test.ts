import { describe, it, expect } from "vitest";
import { tabPath } from "./tabPaths";
import type { TabType } from "../store/tabStore";

const ALL_TYPES: TabType[] = [
  "design", "table", "process-flow", "sequence", "view", "view-definition", "screen-items", "page-layout", "business-flow", "report",
  "screen-flow", "screen-list", "table-list", "er", "process-flow-list", "extensions", "conventions-catalog", "sequence-list", "view-list",
  "view-definition-list", "workspace-list", "tech-stack", "dashboard", "page-layout-list", "gadget-list", "generic-definition",
  "generic-definition-list", "generic-definition-catalog", "report-list", "business-flow-list", "design-document", "design-analysis",
];

describe("tabPath (タブ → URL)", () => {
  it("すべての種類のタブに、URL がある", () => {
    for (const type of ALL_TYPES) expect(tabPath("/w/ws1", { type, resourceId: "x" }), type).not.toBeNull();
  });

  it("設計のタブは ID つき、一覧・singleton のタブは固定の URL、ワークスペース一覧だけワークスペースの外", () => {
    expect(tabPath("/w/ws1", { type: "table", resourceId: "orders" })).toBe("/w/ws1/table/edit/orders");
    expect(tabPath("/w/ws1", { type: "design", resourceId: "cart" })).toBe("/w/ws1/screen/design/cart");
    expect(tabPath("/w/ws1", { type: "screen-items", resourceId: "cart" })).toBe("/w/ws1/screen/items/cart");
    expect(tabPath("/w/ws1", { type: "table-list", resourceId: "main" })).toBe("/w/ws1/table/list");
    expect(tabPath("/w/ws1", { type: "dashboard", resourceId: "main" })).toBe("/w/ws1/");
    expect(tabPath("/w/ws1", { type: "design-analysis", resourceId: "main" })).toBe("/w/ws1/analysis");
    expect(tabPath("/w/ws1", { type: "workspace-list", resourceId: "main" })).toBe("/workspace/list");
  });

  it("汎用定義は、種類と名前の区切り (:) を / にする", () => {
    expect(tabPath("/w/ws1", { type: "generic-definition", resourceId: "message:OrderMessages" })).toBe("/w/ws1/generic-definition/message/OrderMessages");
    expect(tabPath("/w/ws1", { type: "generic-definition-list", resourceId: "message" })).toBe("/w/ws1/generic-definition/message");
  });

  it("知らない種類は null", () => {
    expect(tabPath("/w/ws1", { type: "nope" as TabType, resourceId: "x" })).toBeNull();
  });
});
