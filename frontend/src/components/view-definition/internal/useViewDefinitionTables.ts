/**
 * ViewDefinitionEditor 用 — テーブル取得 hooks (Phase-4 抽出)
 *
 * - useTablesForValidator: validator 入力用 (Table 全フィールド)
 * - useTableOptions: cascade 選択肢生成用 (id / name / columns subset)
 *
 * 両者とも `tableStore.onTableChange` + `mcpBridge` broadcast を購読し、
 * 他クライアントの編集や同一クライアント内 SPA 遷移にも追従する。
 */
import { useEffect, useState } from "react";
import type { TableEntry, Table } from "../../../types/v3";
import { listTables, loadTable, onTableChange } from "../../../store/tableStore";
import { mcpBridge } from "../../../mcp/mcpBridge";
import type { TableDefinitionForView } from "../../../schemas/viewDefinitionValidator";

export function useTablesForValidator(): TableDefinitionForView[] {
  const [tables, setTables] = useState<TableDefinitionForView[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      const entries = await listTables();
      const all = await Promise.all(entries.map((e: TableEntry) => loadTable(e.id)));
      const valid = all.filter((t): t is Table => t !== null);
      if (!cancelled) {
        // Table is shape-compatible with TableDefinitionForView (id / name / physicalName / columns)
        setTables(valid as unknown as TableDefinitionForView[]);
      }
    }
    refresh().catch(console.error);
    // #1001: 同一 client 内 SPA 遷移先での table 変更通知 + 他 client (mcpBridge broadcast) 両カバー
    const unsubLocal = onTableChange(() => { refresh().catch(console.error); });
    const unsubBroadcast = mcpBridge.onBroadcast("tableChanged", () => { refresh().catch(console.error); });
    return () => {
      cancelled = true;
      unsubLocal();
      unsubBroadcast();
    };
  }, []);
  return tables;
}

export interface TableOption {
  id: string;
  name: string;
  columns: Array<{ id: string; name: string; physicalName: string }>;
}

export function useTableOptions(): TableOption[] {
  const [options, setOptions] = useState<TableOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      const entries = await listTables();
      const tables = await Promise.all(entries.map((e: TableEntry) => loadTable(e.id)));
      if (!cancelled) {
        setOptions(
          tables
            .filter((t): t is Table => t !== null)
            .map((t) => ({
              id: t.id,
              name: t.name ?? t.physicalName ?? t.id,
              columns: (t.columns ?? []).map((c) => ({
                id: c.id,
                name: c.name ?? c.physicalName ?? c.id,
                physicalName: c.physicalName ?? c.id,
              })),
            })),
        );
      }
    }
    refresh().catch(console.error);
    // #1001: 同一 client 内 SPA 遷移先での table 変更通知 + 他 client (mcpBridge broadcast) 両カバー
    const unsubLocal = onTableChange(() => { refresh().catch(console.error); });
    const unsubBroadcast = mcpBridge.onBroadcast("tableChanged", () => { refresh().catch(console.error); });
    return () => {
      cancelled = true;
      unsubLocal();
      unsubBroadcast();
    };
  }, []);
  return options;
}
