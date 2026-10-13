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
import { loadAllTables, onTableChange } from "../../../store/tableStore";
import { mcpBridge } from "../../../mcp/mcpBridge";
import type { TableDefinitionForView } from "../../../schemas/viewDefinitionValidator";
import { reportFailure } from "../../../utils/failureToast";

export function useTablesForValidator(): TableDefinitionForView[] {
  const [tables, setTables] = useState<TableDefinitionForView[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      const valid = await loadAllTables(); // 全テーブルを 1 回の問い合わせで
      if (!cancelled) {
        // Table is shape-compatible with TableDefinitionForView (id / name / physicalName / columns)
        setTables(valid as unknown as TableDefinitionForView[]);
      }
    }
    refresh().catch((err) => reportFailure(err, "ビュー定義のテーブルの読み込み"));
    // #1001: 同一 client 内 SPA 遷移先での table 変更通知 + 他 client (mcpBridge broadcast) 両カバー
    const unsubLocal = onTableChange(() => { refresh().catch((err) => reportFailure(err, "ビュー定義のテーブルの読み込み")); });
    const unsubBroadcast = mcpBridge.onBroadcast("tableChanged", () => { refresh().catch((err) => reportFailure(err, "ビュー定義のテーブルの読み込み")); });
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
      const tables = await loadAllTables(); // 全テーブルを 1 回の問い合わせで
      if (!cancelled) {
        setOptions(
          tables
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
    refresh().catch((err) => reportFailure(err, "ビュー定義のテーブルの読み込み"));
    // #1001: 同一 client 内 SPA 遷移先での table 変更通知 + 他 client (mcpBridge broadcast) 両カバー
    const unsubLocal = onTableChange(() => { refresh().catch((err) => reportFailure(err, "ビュー定義のテーブルの読み込み")); });
    const unsubBroadcast = mcpBridge.onBroadcast("tableChanged", () => { refresh().catch((err) => reportFailure(err, "ビュー定義のテーブルの読み込み")); });
    return () => {
      cancelled = true;
      unsubLocal();
      unsubBroadcast();
    };
  }, []);
  return options;
}
