/**
 * テストデータの生成。テーブルの定義 (型・長さ・NOT NULL・主キー・一意・外部キー・CHECK) に沿った、サンプルの行を作る。
 * 同じ設定 (seed・件数) なら同じデータ。親テーブルを先に作り、外部キーは親の行から選ぶ。
 * CHECK 式は、単純な比較 (`col > 0` / `col IN ('a','b')` / `col BETWEEN 1 AND 9`) だけを考慮し、読めない式は警告する。
 */
import type { DesignDocInput, DocTable } from "../designDocument.js";
import { toCsv } from "./common.js";

export type Cell = string | number | boolean | null;
export interface GeneratedTable {
  table: { id: string; physicalName: string; name: string };
  columns: string[];
  rows: Cell[][];
}
export interface TestDataResult { tables: GeneratedTable[]; warnings: string[] }
export interface TestDataOptions {
  /** 乱数の種 (同じ値なら同じデータ) */
  seed?: number;
  /** 1 テーブルあたりの行数 (既定 10、上限 1000) */
  rowsPerTable?: number;
  /** テーブルごとの行数 (rowsPerTable より優先) */
  rows?: Record<string, number>;
  /** 対象のテーブル (省略なら全部。外部キーの親は、対象外でも先に作る) */
  tableIds?: string[];
  /** NULL を許す列に、ときどき NULL を入れる */
  nulls?: boolean;
}

const MAX_ROWS = 1000;
const SURNAMES = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤"];
const GIVEN = ["太郎", "花子", "健一", "美咲", "大輔", "陽子", "翔太", "結衣", "拓也", "彩"];
const CITIES = ["東京都千代田区", "大阪府大阪市", "愛知県名古屋市", "福岡県福岡市", "北海道札幌市", "宮城県仙台市"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Bounds { min?: number; max?: number; oneOf?: string[] }

/** CHECK 式から、列ごとの範囲・候補を読む (単純な比較だけ) */
function parseChecks(t: DocTable, warnings: string[]): Map<string, Bounds> {
  const out = new Map<string, Bounds>();
  const colOf = (name: string) => (t.columns ?? []).find((c) => c.physicalName.toLowerCase() === name.toLowerCase())?.physicalName;
  for (const c of t.constraints ?? []) {
    if (c.kind !== "check" || !c.expression) continue;
    let handled = false;
    for (const part of c.expression.split(/\s+AND\s+/i)) {
      const p = part.trim().replace(/^\(|\)$/g, "");
      let m: RegExpExecArray | null;
      if ((m = /^"?([A-Za-z_]\w*)"?\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(p)) && colOf(m[1])) {
        const b = out.get(colOf(m[1])!) ?? {}; const n = Number(m[3]);
        if (m[2] === ">=") b.min = n; else if (m[2] === ">") b.min = n + 1; else if (m[2] === "<=") b.max = n; else b.max = n - 1;
        out.set(colOf(m[1])!, b); handled = true;
      } else if ((m = /^"?([A-Za-z_]\w*)"?\s+BETWEEN\s+(-?\d+(?:\.\d+)?)\s+AND\s+(-?\d+(?:\.\d+)?)$/i.exec(p)) && colOf(m[1])) {
        out.set(colOf(m[1])!, { ...(out.get(colOf(m[1])!) ?? {}), min: Number(m[2]), max: Number(m[3]) }); handled = true;
      } else if ((m = /^"?([A-Za-z_]\w*)"?\s+IN\s*\(([^)]*)\)$/i.exec(p)) && colOf(m[1])) {
        const vals = [...m[2].matchAll(/'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)/g)].map((x) => (x[1] ?? x[2]).replace(/''/g, "'"));
        if (vals.length) { out.set(colOf(m[1])!, { ...(out.get(colOf(m[1])!) ?? {}), oneOf: vals }); handled = true; }
      }
    }
    if (!handled) warnings.push(`テーブル「${t.name ?? t.id}」の CHECK 式「${c.expression}」は、読めないため考慮していません`);
  }
  return out;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const isIntType = (dt: string) => /^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|SERIAL|BIGSERIAL)/i.test(dt);
const isDecimalType = (dt: string) => /^(DECIMAL|NUMERIC|NUMBER|FLOAT|DOUBLE|REAL|MONEY)/i.test(dt);
const isTextType = (dt: string) => /^(VARCHAR|CHAR|NVARCHAR|NCHAR|TEXT|STRING|CLOB|VARCHAR2)/i.test(dt);

function textFor(colName: string, display: string | undefined, n: number, rnd: () => number): string {
  const key = colName.toLowerCase();
  if (/mail/.test(key)) return `user${n}@example.com`;
  if (/(tel|phone|fax)/.test(key)) return `03-${pad(1000 + (n % 9000), 4)}-${pad(n % 10000, 4)}`;
  if (/(zip|postal)/.test(key)) return `${pad(100 + (n % 800), 3)}-${pad(n % 10000, 4)}`;
  if (/(address|addr)/.test(key) || /住所/.test(display ?? "")) return `${CITIES[Math.floor(rnd() * CITIES.length)]}${n}-${(n % 20) + 1}`;
  if (/(^|_)(name|nm)(_|$)|name$/.test(key) || /(氏名|名前|名称|顧客名)$/.test(display ?? "")) return `${SURNAMES[(n - 1) % SURNAMES.length]} ${GIVEN[Math.floor(rnd() * GIVEN.length)]}`;
  if (/code|cd$/.test(key)) return `${(display ?? colName).replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "CODE"}${pad(n, 4)}`;
  return `${display || colName}${n}`;
}

export function generateTestData(input: DesignDocInput, options: TestDataOptions = {}): TestDataResult {
  const warnings: string[] = [];
  const rnd = mulberry32(options.seed ?? 1);
  const byId = new Map(input.tables.map((t) => [t.id, t]));
  const wanted = new Set(options.tableIds ?? input.tables.map((t) => t.id));
  const rowCount = (id: string) => Math.max(1, Math.min(MAX_ROWS, Math.floor(options.rows?.[id] ?? options.rowsPerTable ?? 10)));

  // 外部キーの親を含めて、親が先になる順に並べる
  const need = new Set<string>();
  const addNeed = (id: string) => { if (need.has(id) || !byId.has(id)) return; need.add(id); for (const c of byId.get(id)!.constraints ?? []) if (c.kind === "foreignKey" && c.referencedTableId && !c.noConstraint) addNeed(c.referencedTableId); };
  for (const id of wanted) addNeed(id);
  const order: string[] = [];
  const state = new Map<string, number>();
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { warnings.push(`テーブル「${byId.get(id)?.name ?? id}」を含む外部キーの循環があります。NULL を許す列は NULL にします`); return; }
    state.set(id, 1);
    for (const c of byId.get(id)!.constraints ?? []) if (c.kind === "foreignKey" && c.referencedTableId && need.has(c.referencedTableId) && c.referencedTableId !== id) visit(c.referencedTableId);
    state.set(id, 2); order.push(id);
  };
  for (const id of need) visit(id);

  const made = new Map<string, { cols: string[]; rows: Cell[][] }>();
  const out: GeneratedTable[] = [];

  for (const id of order) {
    const t = byId.get(id)!;
    const cols = t.columns ?? [];
    const colIdx = new Map(cols.map((c, i) => [c.id ?? c.physicalName, i]));
    const idxOf = (colId: string) => colIdx.get(colId) ?? cols.findIndex((c) => c.physicalName === colId);
    const bounds = parseChecks(t, warnings);
    let n = rowCount(id);

    // 外部キー: 列 → (親テーブル・親の列)
    const fks = (t.constraints ?? []).filter((c) => c.kind === "foreignKey" && c.referencedTableId && !c.noConstraint && (c.columnIds ?? []).length);
    const fkOf = new Map<number, { fk: (typeof fks)[number]; pos: number }>();
    for (const fk of fks) (fk.columnIds ?? []).forEach((cid, pos) => { const i = idxOf(cid); if (i >= 0) fkOf.set(i, { fk, pos }); });
    for (const fk of fks) {
      const parent = made.get(fk.referencedTableId!);
      if (!parent || !parent.rows.length) {
        const nullable = (fk.columnIds ?? []).every((cid) => !cols[idxOf(cid)]?.notNull && !cols[idxOf(cid)]?.primaryKey);
        if (!nullable) warnings.push(`テーブル「${t.name ?? id}」の外部キーの親の行がないため、値を作れません (${fk.referencedTableId})`);
      }
    }

    // 一意の組み合わせが作れる最大数 (外部キー由来の列だけの一意制約は、親の行数が上限)
    const uniqueSets: number[][] = [
      ...cols.map((c, i) => (c.unique || c.primaryKey ? [i] : null)).filter((x): x is number[] => !!x),
      ...(t.constraints ?? []).filter((c) => (c.kind === "unique" || c.kind === "primaryKey") && (c.columnIds ?? []).length).map((c) => (c.columnIds ?? []).map(idxOf).filter((i) => i >= 0)),
    ].filter((s) => s.length);
    for (const set of uniqueSets) {
      if (set.every((i) => fkOf.has(i))) {
        const parents = new Set(set.map((i) => fkOf.get(i)!.fk.referencedTableId!));
        const cap = [...parents].reduce((m, pid) => m * (made.get(pid)?.rows.length || 1), 1);
        if (n > cap) { warnings.push(`テーブル「${t.name ?? id}」は、一意の外部キーのため、行数を親の行数 (${cap}) に減らしました`); n = cap; }
      }
    }

    const rows: Cell[][] = [];
    const parentPick = (fk: (typeof fks)[number], row: number) => {
      const parent = made.get(fk.referencedTableId!);
      if (!parent?.rows.length) return null;
      return parent.rows[row % parent.rows.length];
    };
    for (let r = 0; r < n; r++) {
      const seq = r + 1;
      const row: Cell[] = cols.map((c, i): Cell => {
        const fkInfo = fkOf.get(i);
        if (fkInfo) {
          const prow = parentPick(fkInfo.fk, r);
          const parent = made.get(fkInfo.fk.referencedTableId!);
          if (prow && parent) {
            const refCol = (fkInfo.fk.referencedColumnIds ?? [])[fkInfo.pos];
            const pi = refCol ? (byId.get(fkInfo.fk.referencedTableId!)!.columns ?? []).findIndex((x) => x.id === refCol || x.physicalName === refCol) : -1;
            if (pi >= 0) return prow[pi];
          }
          return c.notNull || c.primaryKey ? "" : null;
        }
        if (options.nulls && !c.notNull && !c.primaryKey && !c.unique && seq % 7 === 0) return null;
        const b = bounds.get(c.physicalName);
        if (b?.oneOf?.length) { const v = b.oneOf[(seq - 1) % b.oneOf.length]; return isIntType(c.dataType ?? "") || isDecimalType(c.dataType ?? "") ? Number(v) : v; }
        const dt = c.dataType ?? "VARCHAR";
        if (/^BOOL/i.test(dt)) return seq % 2 === 1;
        if (isIntType(dt)) {
          let v = seq; if (b?.min !== undefined) v = Math.ceil(b.min) + (seq - 1); if (b?.max !== undefined && v > b.max) v = Math.floor(b.max);
          if (!c.primaryKey && !c.unique && !c.autoIncrement && b?.min === undefined && b?.max === undefined && !/(id|no|num|seq)$/i.test(c.physicalName)) v = Math.floor(rnd() * 100) + 1;
          return v;
        }
        if (isDecimalType(dt)) {
          const scale = c.scale ?? (/^(FLOAT|DOUBLE|REAL)/i.test(dt) ? 2 : 0);
          const intDigits = Math.max(1, (c.length ?? 10) - scale);
          let v = Math.round((rnd() * Math.min(10 ** Math.min(intDigits, 6) - 1, 100000) + 1) * 10 ** scale) / 10 ** scale;
          if (b?.min !== undefined) v = Math.max(v, b.min); if (b?.max !== undefined) v = Math.min(v, b.max);
          return v;
        }
        if (/^DATE$/i.test(dt)) { const d = new Date(Date.UTC(2025, 0, 1) + (seq - 1) * 86400000); return d.toISOString().slice(0, 10); }
        if (/^(TIMESTAMP|DATETIME)/i.test(dt)) { const d = new Date(Date.UTC(2025, 0, 1, 9, 0, 0) + (seq - 1) * 3600000 * 5); return d.toISOString().slice(0, 19).replace("T", " "); }
        if (/^TIME/i.test(dt)) return `${pad(9 + (seq % 9), 2)}:${pad((seq * 7) % 60, 2)}:00`;
        if (/^(JSON|JSONB)/i.test(dt)) return "{}";
        if (/^(BLOB|BYTEA|BINARY|VARBINARY)/i.test(dt)) return c.notNull ? "" : null;
        if (isTextType(dt) || true) {
          let s = textFor(c.physicalName, c.name, seq, rnd);
          if (c.length && s.length > c.length) {
            // 長さを超えるときは、末尾の連番を残して切る (一意を保つ)
            const tail = String(seq);
            s = c.length > tail.length ? s.slice(0, c.length - tail.length) + tail : tail.slice(-c.length);
          }
          return s;
        }
        return null;
      });
      rows.push(row);
    }
    made.set(id, { cols: cols.map((c) => c.physicalName), rows });
    if (wanted.has(id)) out.push({ table: { id, physicalName: t.physicalName ?? id, name: t.name ?? id }, columns: cols.map((c) => c.physicalName), rows });
  }
  return { tables: out, warnings };
}

// ── 書き出し ──────────────────────────────────────────────────────────

export type SqlQuote = "standard" | "mysql" | "sqlserver";
const quoteId = (s: string, q: SqlQuote) => (q === "mysql" ? `\`${s.replace(/`/g, "``")}\`` : q === "sqlserver" ? `[${s.replace(/]/g, "]]")}]` : `"${s.replace(/"/g, '""')}"`);
const lit = (v: Cell, q: SqlQuote): string => (v === null ? "NULL" : typeof v === "number" ? String(v) : typeof v === "boolean" ? (q === "sqlserver" || q === "mysql" ? (v ? "1" : "0") : v ? "TRUE" : "FALSE") : `${q === "sqlserver" && /[^\x00-\x7f]/.test(v) ? "N" : ""}'${v.replace(/'/g, "''")}'`);

export function testDataToInsertSql(r: TestDataResult, quote: SqlQuote = "standard"): string {
  return r.tables.map((t) => {
    const head = `INSERT INTO ${quoteId(t.table.physicalName, quote)} (${t.columns.map((c) => quoteId(c, quote)).join(", ")}) VALUES`;
    return `-- ${t.table.name} (${t.rows.length} 件)\n${head}\n${t.rows.map((row) => `  (${row.map((v) => lit(v, quote)).join(", ")})`).join(",\n")};\n`;
  }).join("\n");
}

export function testDataTableToCsv(t: GeneratedTable): string {
  return toCsv(t.columns, t.rows);
}
