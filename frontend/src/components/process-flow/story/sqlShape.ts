/**
 * 検索 (SELECT) の結果が、1 件を探す形か、一覧になりうる形かの推定 (処理フローの「流れ」表示)。
 * 仕様: docs/spec/process-flow-story-view.md「検索の結果は 1 件か一覧か」。決まりのない部分の推定なので、断定には使わない。
 */

/** テーブルの物理名 (小文字) → 1 行を決める列の組 (主キー・単独の一意列・一意制約・一意インデックス)。物理名の列は小文字 */
export type ShapeEnv = ReadonlyMap<string, ReadonlyArray<readonly string[]>>;

export interface ShapeTable {
  physicalName: string;
  /** 1 行を決める列の組 (物理名) */
  uniqueKeys?: ReadonlyArray<readonly string[]>;
}

export function buildShapeEnv(tables: ReadonlyArray<ShapeTable> | undefined): ShapeEnv {
  const m = new Map<string, ReadonlyArray<readonly string[]>>();
  for (const t of tables ?? []) if (t.physicalName && t.uniqueKeys) m.set(t.physicalName.toLowerCase(), t.uniqueKeys.map((k) => k.map((c) => c.toLowerCase())));
  return m;
}

/** コメントと文字列を落とし、識別子の引用符を外す */
function clean(sql: string): string {
  const s = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
  return s.replace(/["`[\]]/g, "");
}

/** 部分クエリ (括弧の中が SELECT / WITH で始まるもの) を「§」にし、ほかの括弧は「⟪⟫」にして中身を残す (集計関数を、入れ子の中でも見つけるため) */
function withoutSubqueries(sql: string): string {
  let s = clean(sql);
  for (let i = 0; i < 30 && /\([^()]*\)/.test(s); i++) s = s.replace(/\(([^()]*)\)/g, (_m, inner: string) => (/^\s*(?:SELECT|WITH)\b/i.test(inner) ? "§" : `⟪${inner}⟫`));
  return s.replace(/\s+/g, " ").trim();
}

/** コメント・文字列・括弧の中 (部分クエリ・窓関数・関数の引数) を落として、いちばん外側の文だけにする */
function outerSql(sql: string): string {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
  // 識別子の引用符 ("id" `id` [id]) を外す
  s = s.replace(/["`[\]]/g, "");
  // 括弧の中は、内側から順に「⟦⟧」に置き換える (関数の名前は残る: COUNT⟦⟧)
  for (let i = 0; i < 30 && /\([^()]*\)/.test(s); i++) s = s.replace(/\([^()]*\)/g, "⟦⟧");
  return s.replace(/\s+/g, " ").trim();
}

interface Eq { alias: string; col: string }

/** WHERE 句の、「列 = 引数」の AND でつないだ条件 (OR を含むときは空) */
function equalityColumns(s: string): Eq[] {
  const m = s.match(/\bWHERE\b(.*?)(?:\bGROUP BY\b|\bORDER BY\b|\bHAVING\b|\bLIMIT\b|\bOFFSET\b|\bFETCH\b|\bUNION\b|$)/i);
  if (!m || /\bOR\b/i.test(m[1])) return [];
  const out: Eq[] = [];
  for (const part of m[1].split(/\bAND\b/i)) {
    const c = part.match(/^\s*(?:(\w+)\.)?(\w+)\s*=\s*[@:$?]/);
    if (c) out.push({ alias: (c[1] ?? "").toLowerCase(), col: c[2].toLowerCase() });
  }
  return out;
}

const KEYWORDS = new Set(["where", "join", "inner", "left", "right", "full", "cross", "on", "group", "order", "limit", "having", "union"]);

/** FROM のテーブルと別名 */
function baseTable(s: string): { table: string; alias: string } | null {
  const m = s.match(/\bFROM (?:\w+\.)*(\w+)(?: (?:AS )?(\w+))?/i);
  if (!m) return null;
  const alias = m[2] && !KEYWORDS.has(m[2].toLowerCase()) ? m[2].toLowerCase() : m[1].toLowerCase();
  return { table: m[1].toLowerCase(), alias };
}

/** 結合 (JOIN) がすべて「多対 1」か: 結合先の、一意の列 (主キーなど) との一致で結んでいれば、行は増えない */
function joinsKeepRows(s: string, env: ShapeEnv | undefined): boolean {
  const joins = [...s.matchAll(/\b(?:INNER |LEFT |RIGHT |FULL |CROSS )?(?:OUTER )?JOIN (?:\w+\.)*(\w+)(?: (?:AS )?(\w+))? ON (\w+)\.(\w+) = (\w+)\.(\w+)/gi)];
  const total = (s.match(/\bJOIN\b/gi) ?? []).length;
  if (joins.length === 0 || joins.length !== total || /\b(?:RIGHT|FULL|CROSS) (?:OUTER )?JOIN\b/i.test(s)) return false;
  return joins.every((j) => {
    const table = j[1].toLowerCase();
    const alias = (j[2] && !KEYWORDS.has(j[2].toLowerCase()) ? j[2] : j[1]).toLowerCase();
    const col = (j[3].toLowerCase() === alias ? j[4] : j[5].toLowerCase() === alias ? j[6] : "").toLowerCase();
    if (!col) return false;
    const keys = env?.get(table);
    return keys ? keys.some((k) => k.length === 1 && k[0] === col) : col === "id";
  });
}

/**
 * 1 件: LIMIT 1 / TOP 1 / FETCH FIRST 1・集計だけ (GROUP BY なし・窓関数でない)・結合のない検索で、1 行を決める列 (主キー・一意) がそろった一致。
 * テーブルの定義が分からないときは、列 `id` の一致を主キーとみなす。それ以外は一覧 (0 件のときは、null ではなく空の一覧になりうる)。
 */
export function selectShape(sql: string, env?: ShapeEnv): "one" | "list" {
  const s = outerSql(sql);
  if (/\bLIMIT 1\b(?!\d)/i.test(s) || /\bSELECT (?:DISTINCT )?TOP 1\b(?!\d)/i.test(s) || /\bFETCH (?:FIRST|NEXT) 1 ROWS?\b/i.test(s)) return "one";
  // 集計だけの検索 (GROUP BY なし・窓関数なし)。集計は、COALESCE(SUM(…), 0) のような入れ子の中でも見る。部分クエリの中は見ない
  const agg = withoutSubqueries(sql);
  const head = agg.match(/\bSELECT\b(.*?)\bFROM\b/i)?.[1] ?? "";
  if (!/\bGROUP BY\b/i.test(agg) && !/\bOVER\b/i.test(head) && /\b(?:COUNT|SUM|AVG|MIN|MAX)\s*⟪/i.test(head)) return "one";
  if (/\bUNION\b/i.test(s) || /\bFROM [^ ]+ *,/i.test(s)) return "list";
  if (/\bJOIN\b/i.test(s) && !joinsKeepRows(s, env)) return "list";
  const base = baseTable(s);
  // 検索の絞り込みは、FROM のテーブル (別名つきならその別名) の列だけを数える
  const cols = equalityColumns(s).filter((e) => !e.alias || (base && e.alias === base.alias)).map((e) => e.col);
  if (cols.length === 0) return "list";
  const keys = base ? env?.get(base.table) : undefined;
  if (keys) return keys.some((k) => k.length > 0 && k.every((c) => cols.includes(c))) ? "one" : "list";
  return cols.includes("id") ? "one" : "list";
}
