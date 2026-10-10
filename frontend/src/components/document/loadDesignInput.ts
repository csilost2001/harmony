/**
 * 設計書の入力 (画面・処理フロー・テーブル・規約・業務フロー・帳票など) を、ワークスペースから読み集める。
 * 設計書ビューとダッシュボードの「設計の要確認」パネルが共有する。
 */
import type { DesignDocInput } from "@harmony/shared";
import { loadRawProject } from "../../store/flowStore";
import { loadScreenEntity } from "../../store/screenStore";
import { listProcessFlows, loadProcessFlow } from "../../store/processFlowStore";
import { listTables, loadTable } from "../../store/tableStore";
import { loadConventions } from "../../store/conventionsStore";
import { loadLayoutComponents } from "../../store/layoutComponentStore";
import { listBusinessFlowsDetailed } from "../../store/businessFlowStore";
import { listReportsDetailed } from "../../store/reportStore";

/** 設計書の入力と、読めなかったために載らないファイル (JSON が壊れている業務フロー・帳票) */
export async function loadDesignInput(): Promise<{ input: DesignDocInput; skipped: string[] }> {
  const raw = await loadRawProject();
  const entities = (raw as { entities?: { screens?: Array<{ id: string }>; screenTransitions?: DesignDocInput["transitions"] } }).entities ?? {};
  const [screens, flowMetas, tableMetas, conventions, layoutComponents, businessFlows, reports] = await Promise.all([
    Promise.all((entities.screens ?? []).map((s) => loadScreenEntity(s.id).catch(() => null))),
    listProcessFlows().catch(() => []),
    listTables().catch(() => []),
    loadConventions().catch(() => null),
    loadLayoutComponents().catch(() => []),
    listBusinessFlowsDetailed().catch(() => ({ flows: [], unreadable: [] as string[] })),
    listReportsDetailed().catch(() => ({ reports: [], unreadable: [] as string[] })),
  ]);
  const [flows, tables] = await Promise.all([
    Promise.all(flowMetas.map((m) => loadProcessFlow(m.id).catch(() => null))),
    Promise.all(tableMetas.map((m) => loadTable(m.id).catch(() => null))),
  ]);
  const meta = (raw as { meta?: { id?: string; name?: string; description?: string } }).meta ?? {};
  const input: DesignDocInput = {
    project: { id: meta.id, name: meta.name ?? "プロジェクト", description: meta.description },
    screens: screens.filter(Boolean) as unknown as DesignDocInput["screens"],
    flows: flows.filter(Boolean) as unknown as DesignDocInput["flows"],
    tables: tables.filter(Boolean) as unknown as DesignDocInput["tables"],
    transitions: entities.screenTransitions ?? [],
    messages: ((conventions as { msg?: DesignDocInput["messages"] } | null)?.msg) ?? {},
    layoutComponents,
    businessFlows: businessFlows.flows,
    reports: reports.reports,
    roles: ((conventions as { role?: DesignDocInput["roles"] } | null)?.role) ?? {},
    permissions: ((conventions as { permission?: DesignDocInput["permissions"] } | null)?.permission) ?? {},
  };
  return { input, skipped: [...businessFlows.unreadable.map((f) => `business-flows/${f}`), ...reports.unreadable.map((f) => `reports/${f}`)] };
}
