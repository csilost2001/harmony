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

/**
 * 設計書の入力と、読めなかったために載らないもの。
 * 読めなかったものを黙って捨てると、「問題なし」の検査になってしまうため、`skipped` に積んで呼び出し側が示す。
 */
export async function loadDesignInput(): Promise<{ input: DesignDocInput; skipped: string[] }> {
  const raw = await loadRawProject();
  const skipped: string[] = [];
  /** 失敗 (または、あるはずのものが無い) を skipped に積み、代わりの値を返す */
  const guard = <T>(label: string, p: Promise<T>, fallback: T): Promise<T> => p.catch(() => { skipped.push(label); return fallback; });
  const guardOne = async <T>(label: string, p: Promise<T | null>): Promise<T | null> => {
    const v = await guard<T | null>(label, p, null);
    if (v === null && !skipped.includes(label)) skipped.push(label);
    return v;
  };
  const entities = (raw as { entities?: { screens?: Array<{ id: string }>; screenTransitions?: DesignDocInput["transitions"] } }).entities ?? {};
  const [screens, flowMetas, tableMetas, conventions, layoutComponents, businessFlows, reports] = await Promise.all([
    Promise.all((entities.screens ?? []).map((s) => guardOne(`画面「${s.id}」`, loadScreenEntity(s.id)))),
    guard("処理フロー一覧", listProcessFlows(), []),
    guard("テーブル一覧", listTables(), []),
    guard("規約カタログ", loadConventions(), null),
    guard("独自部品", loadLayoutComponents(), []),
    guard("業務フロー一覧", listBusinessFlowsDetailed(), { flows: [], unreadable: [] as string[] }),
    guard("帳票一覧", listReportsDetailed(), { reports: [], unreadable: [] as string[] }),
  ]);
  const [flows, tables] = await Promise.all([
    Promise.all(flowMetas.map((m) => guardOne(`処理フロー「${m.id}」`, loadProcessFlow(m.id)))),
    Promise.all(tableMetas.map((m) => guardOne(`テーブル「${m.id}」`, loadTable(m.id)))),
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
    limits: ((conventions as { limit?: DesignDocInput["limits"] } | null)?.limit) ?? {},
    regex: ((conventions as { regex?: DesignDocInput["regex"] } | null)?.regex) ?? {},
  };
  return { input, skipped: [...skipped, ...businessFlows.unreadable.map((f) => `business-flows/${f}`), ...reports.unreadable.map((f) => `reports/${f}`)] };
}
