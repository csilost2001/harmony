/**
 * 画面項目 ↔ DB カラムの対応表。入力項目の保存先 (どのテーブルのどの列に結び付いているか) を 1 枚にまとめ、
 * 保存先の決まっていない入力項目・存在しない列を指している項目・どこからも使われていない列 を見つける。
 */
import type { DesignDocInput, DocIssueRef } from "../designDocument.js";
import { isInputItem } from "../testViewpoints.js";
import { bindingColumnRef, forEachStep, toCsv } from "./common.js";
import { parseSource } from "../report.js";

export interface ColumnMapRow {
  screen: { id: string; name: string };
  item: { id: string; label: string; direction?: string };
  /** mapped = 列に結び付いている / other = 列以外 (フォーム・変数など) に結び付いている / unbound = 結び付いていない / broken = 存在しない列を指している */
  status: "mapped" | "other" | "unbound" | "broken";
  binding?: { kind?: string; path?: string };
  table?: { id: string; name: string };
  column?: { id?: string; physicalName: string; name?: string };
  note?: string;
}

export interface UnusedColumn { table: { id: string; name: string }; column: { id?: string; physicalName: string; name?: string }; ref: DocIssueRef }

export interface ColumnMapResult {
  rows: ColumnMapRow[];
  /** 入力項目で、保存先も受け渡し先も決まっていないもの */
  unboundInputs: ColumnMapRow[];
  brokenBindings: ColumnMapRow[];
  unusedColumns: UnusedColumn[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function deriveColumnMap(input: DesignDocInput): ColumnMapResult {
  const tables = new Map(input.tables.map((t) => [t.id, t]));
  const rows: ColumnMapRow[] = [];

  const boundCols = new Map<string, Set<string>>(); // tableId → 使われている列 (Column.id と物理名の両方)
  const markBound = (tableId: string, col: string | undefined) => {
    if (!col) return;
    const set = boundCols.get(tableId) ?? boundCols.set(tableId, new Set()).get(tableId)!;
    set.add(col);
    const c = tables.get(tableId)?.columns?.find((x) => x.id === col || x.physicalName === col);
    if (c) { if (c.id) set.add(c.id); set.add(c.physicalName); }
  };

  for (const s of input.screens.filter((x) => x.purpose !== "gadget")) {
    for (const it of s.items ?? []) {
      const base = { screen: { id: s.id, name: s.name ?? s.id }, item: { id: it.id, label: it.label ?? it.id, ...(it.direction ? { direction: it.direction } : {}) }, ...(it.binding ? { binding: { kind: it.binding.kind, ...(it.binding.path ? { path: it.binding.path } : {}) } } : {}) };
      const ref = bindingColumnRef(it);
      if (ref) {
        const t = tables.get(ref.tableId);
        const col = ref.columnId ? t?.columns?.find((c) => c.id === ref.columnId || c.physicalName === ref.columnId) : undefined;
        if (!t || (ref.columnId && !col)) {
          rows.push({ ...base, status: "broken", ...(t ? { table: { id: t.id, name: t.name ?? t.id } } : { table: { id: ref.tableId, name: ref.tableId } }), note: !t ? `テーブル「${ref.tableId}」がありません` : `テーブル「${t.name ?? t.id}」に列「${ref.columnId}」がありません` });
        } else {
          markBound(ref.tableId, ref.columnId);
          rows.push({ ...base, status: "mapped", table: { id: t.id, name: t.name ?? t.id }, ...(col ? { column: { ...(col.id ? { id: col.id } : {}), physicalName: col.physicalName, ...(col.name ? { name: col.name } : {}) } } : {}) });
        }
      } else if (it.binding?.kind) {
        rows.push({ ...base, status: "other" });
      } else if (isInputItem(it as never)) {
        rows.push({ ...base, status: "unbound", note: "この入力の保存先も、受け渡し先も決まっていません" });
      }
    }
  }

  // 列が使われているか: 画面項目の結び付き / 処理フローの SQL・対象フィールド / 帳票の出どころ
  const sqlOf = new Map<string, string>();
  const opaque = new Set<string>(); // 列を指定せずに触るテーブル (SELECT * や、SQL のない記述) は、列単位で使用を判断できない
  for (const f of input.flows) for (const a of f.actions) forEachStep(a.steps, (st) => {
    const x = st as Record<string, unknown>;
    if (st.kind !== "dbAccess" || typeof x.tableId !== "string") return;
    const text = `${String(x.sql ?? "")}\n${String(x.fields ?? "")}\n${String(x.naturalQuery ?? "")}`;
    sqlOf.set(x.tableId, `${sqlOf.get(x.tableId) ?? ""}\n${text}`);
    if (!text.trim() || /\*/.test(String(x.sql ?? "")) || /(^|[^A-Za-z0-9_])(全列|全項目|all columns)/i.test(text)) opaque.add(x.tableId);
  });
  for (const r of input.reports ?? []) for (const sec of r.sections) for (const fld of sec.fields) {
    const p = fld.source ? parseSource(fld.source) : null;
    if (p?.kind === "column") markBound(p.table, p.column);
  }

  const unusedColumns: UnusedColumn[] = [];
  const dbDefault = Object.values(input.db ?? {}).find((d) => d.default) ?? (Object.values(input.db ?? {}).length === 1 ? Object.values(input.db ?? {})[0] : undefined);
  const housekeeping = new Set([...(dbDefault?.timestampColumns ?? []), ...(dbDefault?.logicalDeleteColumn ? [dbDefault.logicalDeleteColumn] : [])].map((x) => x.toLowerCase()));
  for (const t of input.tables) {
    // どこからも使われていないテーブルは、「未使用の定義」で扱う。列単位は、使われているテーブルだけ
    const touched = sqlOf.has(t.id) || boundCols.has(t.id);
    if (!touched || opaque.has(t.id)) continue;
    const fkCols = new Set((t.constraints ?? []).filter((c) => c.kind === "foreignKey").flatMap((c) => c.columnIds ?? []));
    const pkCols = new Set((t.constraints ?? []).filter((c) => c.kind === "primaryKey").flatMap((c) => c.columnIds ?? []));
    const text = sqlOf.get(t.id) ?? "";
    for (const c of t.columns ?? []) {
      if (c.primaryKey || (c.id && (fkCols.has(c.id) || pkCols.has(c.id))) || housekeeping.has(c.physicalName.toLowerCase())) continue;
      const bound = boundCols.get(t.id);
      if ((c.id && bound?.has(c.id)) || bound?.has(c.physicalName)) continue;
      if (new RegExp(`(^|[^A-Za-z0-9_])${esc(c.physicalName)}([^A-Za-z0-9_]|$)`, "i").test(text)) continue;
      unusedColumns.push({ table: { id: t.id, name: t.name ?? t.id }, column: { ...(c.id ? { id: c.id } : {}), physicalName: c.physicalName, ...(c.name ? { name: c.name } : {}) }, ref: { kind: "table", id: t.id } });
    }
  }
  return { rows, unboundInputs: rows.filter((r) => r.status === "unbound"), brokenBindings: rows.filter((r) => r.status === "broken"), unusedColumns };
}

export function columnMapToCsv(r: ColumnMapResult): string {
  const STATUS = { mapped: "列に結び付いている", other: "列以外に結び付いている", unbound: "結び付いていない", broken: "存在しない列を指している" } as const;
  return toCsv(
    ["画面", "画面項目", "項目 ID", "方向", "状態", "結び付き", "テーブル", "列 (物理名)", "列 (論理名)", "備考"],
    r.rows.map((x) => [x.screen.name, x.item.label, x.item.id, x.item.direction ?? "", STATUS[x.status], x.binding?.kind ?? "", x.table?.name ?? "", x.column?.physicalName ?? "", x.column?.name ?? "", x.note ?? ""]),
  );
}
