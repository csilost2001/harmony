/**
 * 機能別定義数パネル
 *
 * プロジェクト内の主要リソース（画面 / テーブル / 処理フロー / FK 関係）の
 * 総数を集計してカード形式で表示する。
 */
import { useEffect, useState } from "react";
import { loadProject } from "../../../store/flowStore";
import { listTables, loadTable } from "../../../store/tableStore";
import { mcpBridge } from "../../../mcp/mcpBridge";

interface Counts {
  screens: number;
  tables: number;
  processFlows: number;
  foreignKeys: number;
}

const INITIAL: Counts = { screens: 0, tables: 0, processFlows: 0, foreignKeys: 0 };

async function fetchCounts(): Promise<Counts> {
  const project = await loadProject();
  const screens = project.screens?.length ?? 0;
  const processFlows = project.processFlows?.length ?? 0;

  const tableMetas = await listTables();
  const tables = tableMetas.length;

  // FK 数は各テーブル定義の Constraint.foreignKey を集計 (v3 で Column.foreignKey は廃止)
  let foreignKeys = 0;
  for (const m of tableMetas) {
    const td = await loadTable(m.id);
    if (!td) continue;
    for (const c of td.constraints ?? []) {
      if (c.kind === "foreignKey") foreignKeys += c.columnIds.length;
    }
  }

  return { screens, tables, processFlows, foreignKeys };
}

export function FunctionCountsPanel() {
  const [counts, setCounts] = useState<Counts>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const reload = async () => {
      try {
        const c = await fetchCounts();
        if (!cancelled) {
          setCounts(c);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    reload();

    // プロジェクト変更 / テーブル変更 / 処理フロー変更で再集計
    const unsubProject = mcpBridge.onBroadcast("projectChanged", reload);
    const unsubTable = mcpBridge.onBroadcast("tableChanged", reload);
    const unsubAction = mcpBridge.onBroadcast("processFlowChanged", reload);
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      if (s === "connected") reload();
    });

    return () => {
      cancelled = true;
      unsubProject();
      unsubTable();
      unsubAction();
      unsubStatus();
    };
  }, []);

  if (error) {
    return <div className="panel-error"><i className="bi bi-exclamation-triangle" /> 集計失敗: {error}</div>;
  }

  const items: Array<{ label: string; value: number; icon: string; color: string }> = [
    { label: "画面", value: counts.screens, icon: "bi-window", color: "#6366f1" },
    { label: "テーブル", value: counts.tables, icon: "bi-table", color: "#0284c7" },
    { label: "処理フロー", value: counts.processFlows, icon: "bi-lightning-charge", color: "#f59e0b" },
    { label: "FK 関係", value: counts.foreignKeys, icon: "bi-share", color: "#10b981" },
  ];

  return (
    <div className="function-counts-panel">
      {items.map((it) => (
        <div key={it.label} className="count-card" style={{ borderLeftColor: it.color }}>
          <i className={`bi ${it.icon}`} style={{ color: it.color }} />
          <div className="count-body">
            <div className="count-value">{loading ? "…" : it.value}</div>
            <div className="count-label">{it.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
