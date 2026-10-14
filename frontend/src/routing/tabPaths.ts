/**
 * タブ → 画面の URL (パス)。AppShell のタブと URL の同期と、並べて表示 (右ペイン) が使う。
 * `wp` は `/w/<wsId>` (ワークスペースの外のタブ (workspace-list) には付かない)。対応が無いタブは null。
 */
import type { TabItem } from "../store/tabStore";

export function tabPath(wp: string, tab: Pick<TabItem, "type" | "resourceId">): string | null {
  const id = tab.resourceId;
  switch (tab.type) {
    case "design": return `${wp}/screen/design/${id}`;
    case "table": return `${wp}/table/edit/${id}`;
    case "process-flow": return `${wp}/process-flow/edit/${id}`;
    case "sequence": return `${wp}/sequence/edit/${id}`;
    case "business-flow": return `${wp}/business-flow/edit/${id}`;
    case "business-flow-list": return `${wp}/business-flow/list`;
    case "report": return `${wp}/report/edit/${id}`;
    case "report-list": return `${wp}/report/list`;
    case "view": return `${wp}/view/edit/${id}`;
    case "view-definition": return `${wp}/view-definition/edit/${id}`;
    case "page-layout": return `${wp}/page-layout/edit/${id}`;
    case "screen-flow": return `${wp}/screen/flow`;
    case "screen-list": return `${wp}/screen/list`;
    case "table-list": return `${wp}/table/list`;
    case "er": return `${wp}/table/er`;
    case "process-flow-list": return `${wp}/process-flow/list`;
    case "extensions": return `${wp}/extensions`;
    case "conventions-catalog": return `${wp}/conventions/catalog`;
    case "design-document": return `${wp}/document`;
    case "design-analysis": return `${wp}/analysis`;
    case "screen-items": return `${wp}/screen/items/${id}`;
    case "sequence-list": return `${wp}/sequence/list`;
    case "view-list": return `${wp}/view/list`;
    case "view-definition-list": return `${wp}/view-definition/list`;
    case "page-layout-list": return `${wp}/page-layout/list`;
    case "gadget-list": return `${wp}/gadget/list`;
    case "generic-definition-catalog": return `${wp}/generic-definition`;
    case "generic-definition-list": return `${wp}/generic-definition/${id}`;
    case "generic-definition": return `${wp}/generic-definition/${id.replace(":", "/")}`;
    case "workspace-list": return "/workspace/list";
    case "tech-stack": return `${wp}/project/tech-stack`;
    case "dashboard": return `${wp}/`;
    default: return null;
  }
}
