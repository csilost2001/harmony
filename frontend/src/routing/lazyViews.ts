/**
 * 画面 (ルートの view) の遅延読み込み。
 *
 * 以前は、すべての画面を静的に import していたため、本番の JS が 1 本 (約 4.9 MB / gzip 1.1 MB) になり、
 * どの画面を開くにも全部を読み込んでいた。ルートごとに分け、開いた画面の分だけを読み込む。
 * 名前つき export (`export function FooView`) をそのまま使えるよう、`lazyNamed` で default に包む。
 *
 * 注意: ここに足す画面は、AppShell など**静的に import しているモジュールから、直接 import しない** (しても動くが、分割されない)。
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** 名前つき export のモジュールを、React.lazy で読み込む */
export function lazyNamed<M extends Record<string, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K] extends ComponentType<infer P> ? ComponentType<P> : never> {
  return lazy(async () => ({ default: (await load())[name] as never }));
}

export const DashboardView = lazyNamed(() => import("../components/dashboard/DashboardView"), "DashboardView");
export const FlowEditor = lazyNamed(() => import("../components/flow/FlowEditor"), "FlowEditor");
export const ScreenListView = lazyNamed(() => import("../components/flow/ScreenListView"), "ScreenListView");
export const TableListView = lazyNamed(() => import("../components/table/TableListView"), "TableListView");
export const TableEditor = lazyNamed(() => import("../components/table/TableEditor"), "TableEditor");
export const ErDiagram = lazyNamed(() => import("../components/table/ErDiagram"), "ErDiagram");
export const ProcessFlowListView = lazyNamed(() => import("../components/process-flow/ProcessFlowListView"), "ProcessFlowListView");
export const ProcessFlowEditor = lazyNamed(() => import("../components/process-flow/ProcessFlowEditor"), "ProcessFlowEditor");
export const ExtensionsPanel = lazyNamed(() => import("../components/extensions/ExtensionsPanel"), "ExtensionsPanel");
export const ConventionsCatalogView = lazyNamed(() => import("../components/conventions/ConventionsCatalogView"), "ConventionsCatalogView");
export const DesignDocumentView = lazyNamed(() => import("../components/document/DesignDocumentView"), "DesignDocumentView");
export const DesignAnalysisView = lazyNamed(() => import("../components/analysis/DesignAnalysisView"), "DesignAnalysisView");
export const ScreenItemsView = lazyNamed(() => import("../components/screen-items/ScreenItemsView"), "ScreenItemsView");
export const SequenceListView = lazyNamed(() => import("../components/sequence/SequenceListView"), "SequenceListView");
export const SequenceEditor = lazyNamed(() => import("../components/sequence/SequenceEditor"), "SequenceEditor");
export const BusinessFlowListView = lazyNamed(() => import("../components/business-flow/BusinessFlowListView"), "BusinessFlowListView");
export const BusinessFlowEditor = lazyNamed(() => import("../components/business-flow/BusinessFlowEditor"), "BusinessFlowEditor");
export const ReportListView = lazyNamed(() => import("../components/report/ReportListView"), "ReportListView");
export const ReportEditor = lazyNamed(() => import("../components/report/ReportEditor"), "ReportEditor");
export const ViewListView = lazyNamed(() => import("../components/view/ViewListView"), "ViewListView");
export const ViewEditor = lazyNamed(() => import("../components/view/ViewEditor"), "ViewEditor");
export const ViewDefinitionListView = lazyNamed(() => import("../components/view-definition/ViewDefinitionListView"), "ViewDefinitionListView");
export const ViewDefinitionEditor = lazyNamed(() => import("../components/view-definition/ViewDefinitionEditor"), "ViewDefinitionEditor");
export const PageLayoutListView = lazyNamed(() => import("../components/page-layout/PageLayoutListView"), "PageLayoutListView");
export const PageLayoutEditor = lazyNamed(() => import("../components/page-layout/PageLayoutEditor"), "PageLayoutEditor");
export const GadgetListView = lazyNamed(() => import("../components/gadget/GadgetListView"), "GadgetListView");
export const GenericDefinitionCatalogView = lazyNamed(() => import("../components/generic-definition/GenericDefinitionCatalogView"), "GenericDefinitionCatalogView");
export const GenericDefinitionListView = lazyNamed(() => import("../components/generic-definition/GenericDefinitionListView"), "GenericDefinitionListView");
export const GenericDefinitionEditor = lazyNamed(() => import("../components/generic-definition/GenericDefinitionEditor"), "GenericDefinitionEditor");
export const WorkspaceListView = lazyNamed(() => import("../components/workspace/WorkspaceListView"), "WorkspaceListView");
export const WorkspaceSelectView = lazyNamed(() => import("../components/workspace/WorkspaceSelectView"), "WorkspaceSelectView");
export const TechStackView = lazyNamed(() => import("../components/project/TechStackView"), "TechStackView");
export const CodexSettingsView = lazyNamed(() => import("../components/codex/CodexSettingsView"), "CodexSettingsView");
export const DesignerTabHost = lazyNamed(() => import("../components/DesignerTabHost"), "DesignerTabHost");
