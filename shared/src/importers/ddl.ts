/**
 * DDL (CREATE TABLE) の取り込み。`pg_dump -s` / `mysqldump --no-data` / 手書きの DDL から、Harmony のテーブル定義 (v3) を作る。
 * 対応: CREATE TABLE (列・型・NOT NULL・DEFAULT・PRIMARY KEY・UNIQUE・AUTO_INCREMENT / SERIAL・COMMENT)、テーブル制約 (PRIMARY KEY / UNIQUE / FOREIGN KEY)、
 * CREATE [UNIQUE] INDEX、ALTER TABLE ... ADD [CONSTRAINT] (PRIMARY KEY / UNIQUE / FOREIGN KEY)、COMMENT ON TABLE / COLUMN。
 * 対応しないもの (トリガ・ビュー・関数・パーティション・CHECK の式) は、読み飛ばして「読み飛ばしたもの」に出す。
 * スキーマ (schemas/v3) は変えない: スキーマの型の一覧にない型は VARCHAR として取り込み、元の型を備考に残す。
 */

export interface ImportedColumn {
  id: string; no: number; physicalName: string; name: string; dataType: string;
  length?: number; scale?: number; notNull?: boolean; primaryKey?: boolean; unique?: boolean; autoIncrement?: boolean; defaultValue?: string; comment?: string;
}
export interface ImportedTable {
  id: string; physicalName: string; name: string; comment?: string;
  columns: ImportedColumn[];
  indexes: Array<{ id: string; physicalName: string; columns: Array<{ columnId: string }>; unique?: boolean }>;
  constraints: Array<Record<string, unknown>>;
}
export interface DdlImportResult { tables: ImportedTable[]; warnings: string[]; skipped: string[] }

const TYPE_MAP: Array<[RegExp, string]> = [
  [/^(character varying|varchar|varchar2|nvarchar|nvarchar2|varying character|string)$/, "VARCHAR"],
  [/^(character|char|nchar|bpchar)$/, "CHAR"],
  [/^(text|tinytext|mediumtext|longtext|clob|ntext)$/, "TEXT"],
  [/^(integer|int|int4|mediumint|serial|serial4)$/, "INTEGER"],
  [/^(bigint|int8|bigserial|serial8)$/, "BIGINT"],
  [/^(smallint|tinyint|int2|smallserial|serial2)$/, "SMALLINT"],
  [/^(decimal|numeric|number|money)$/, "DECIMAL"],
  [/^(float|float4|float8|real|double|double precision)$/, "FLOAT"],
  [/^(boolean|bool|bit)$/, "BOOLEAN"],
  [/^date$/, "DATE"],
  [/^(time|timetz|time without time zone|time with time zone)$/, "TIME"],
  [/^(timestamp|timestamptz|datetime|datetime2|smalldatetime|timestamp without time zone|timestamp with time zone)$/, "TIMESTAMP"],
  [/^(blob|bytea|binary|varbinary|tinyblob|mediumblob|longblob|image)$/, "BLOB"],
  [/^(json|jsonb)$/, "JSON"],
];
const SERIALS = /^(serial|serial4|bigserial|serial8|smallserial|serial2)$/;

/** コメント (-- と block) と、文字列の中身を壊さずに、文に分ける */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  let dollar: string | null = null;
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (dollar) {
      if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; } else { cur += c; i++; }
      continue;
    }
    if (c === "-" && d === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
    if (c === "#" && (i === 0 || sql[i - 1] === "\n")) { while (i < n && sql[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      const end = sql.indexOf("*/", i + 2);
      // MySQL のダンプの `/*!40101 ... */` は、読み飛ばす (実行用の設定)
      i = end < 0 ? n : end + 2; cur += " "; continue;
    }
    // ドル引用 ($tag$ … $tag$)。識別子の途中の `$` (x$y$z) は、開始と見なさない
    if (c === "$" && !/[\w$]/.test(sql[i - 1] ?? "")) { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40)); if (m) { dollar = m[0]; cur += m[0]; i += m[0].length; continue; } }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < n) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } if (sql[j] === "\\" && c === "'") j++; j++; }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 括弧の外の、カンマで分ける (文字列・引用符の中は分けない) */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "", i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length) { if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } break; } if (s[j] === "\\" && c === "'") j++; j++; }
      cur += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(cur.trim()); cur = ""; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const unquote = (s: string): string => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("`") && t.endsWith("`")) || (t.startsWith("[") && t.endsWith("]"))) return t.slice(1, -1);
  return t;
};
/** `schema.table` → table (引用符つきも) */
const objName = (s: string): string => {
  const parts: string[] = [];
  let cur = "", q = "";
  for (const c of s.trim()) {
    if (q) { cur += c; if (c === q) q = ""; continue; }
    if (c === '"' || c === "`") { q = c; cur += c; continue; }
    if (c === ".") { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return unquote(parts[parts.length - 1] ?? s);
};
const idList = (s: string): string[] => splitTop(s).map((x) => unquote(x.replace(/\s+(asc|desc)\b.*$/i, "").replace(/\(\d+\)$/, "")));

/** 物理名 (snake_case 小文字) へ。変えた場合は true も返す */
export function toPhysicalName(raw: string): { name: string; changed: boolean } {
  let n = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  if (!/^[a-z]/.test(n)) n = `c_${n.replace(/^_+/, "")}`;
  n = n.slice(0, 63).replace(/_+$/, "") || "c";
  return { name: n, changed: n !== raw };
}
const kebab = (physical: string): string => physical.replace(/_/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "table";

interface RawCol { name: string; typeText: string; rest: string }

function mapType(typeText: string): { dataType: string; length?: number; scale?: number; mapped: boolean; original: string; serial: boolean } {
  const m = /^([A-Za-z_][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?\s*(?:\[\])?\s*(unsigned|zerofill|signed)?\s*$/i.exec(typeText.trim().replace(/\s+/g, " "));
  const base = (m?.[1] ?? typeText).trim().toLowerCase();
  const serial = SERIALS.test(base);
  for (const [re, t] of TYPE_MAP) {
    if (re.test(base)) {
      const length = m?.[2] !== undefined ? Number(m[2]) : undefined;
      const scale = m?.[3] !== undefined ? Number(m[3]) : undefined;
      // BIT(1) 以外の bit、TINYINT(1) は boolean とせず、型の対応表のとおり
      return { dataType: t, ...(length !== undefined && ["VARCHAR", "CHAR", "DECIMAL"].includes(t) ? { length } : {}), ...(scale !== undefined && t === "DECIMAL" ? { scale } : {}), mapped: true, original: typeText.trim(), serial };
    }
  }
  const length = m?.[2] !== undefined ? Number(m[2]) : undefined;
  return { dataType: "VARCHAR", ...(base === "uuid" ? { length: 36 } : length !== undefined ? { length } : {}), mapped: false, original: typeText.trim(), serial: false };
}

/** 列定義 1 行を、名前・型・残りに分ける */
function splitColumnDef(def: string): RawCol | null {
  const m = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+([\s\S]*)$/.exec(def.trim());
  if (!m) return null;
  const name = unquote(m[1]);
  const body = m[2];
  // 型は、制約キーワードの手前まで
  const stop = /(?<!\s)\s+(?:NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|AUTO_INCREMENT|AUTOINCREMENT|GENERATED|COMMENT|COLLATE|CHARACTER\s+SET|CONSTRAINT|ON\s+UPDATE|IDENTITY)\b/i.exec(body);
  const typeText = stop ? body.slice(0, stop.index) : body;
  return { name, typeText: typeText.trim(), rest: stop ? body.slice(stop.index) : "" };
}

const stringLiteral = (s: string): string => s.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'");

export function parseDdl(sql: string): DdlImportResult {
  const warnings: string[] = [];
  const skipped: string[] = [];
  const tables: ImportedTable[] = [];
  const byPhysical = new Map<string, ImportedTable>();
  const statements = splitStatements(sql);

  const findTable = (name: string): ImportedTable | undefined => byPhysical.get(toPhysicalName(objName(name)).name);
  const colIdByName = (t: ImportedTable, original: string): string | undefined => t.columns.find((c) => c.physicalName === toPhysicalName(original).name)?.id;
  let cseq = 0;
  const addConstraint = (t: ImportedTable, rest: string, nameHint?: string) => {
    const pk = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(rest);
    const uq = /^UNIQUE(?:\s+(?:KEY|INDEX))?\s*(?:("[^"]+"|`[^`]+`|\w+)\s*)?\(([^)]*)\)/i.exec(rest);
    const fk = /^FOREIGN\s+KEY\s*(?:[`"\w]+\s*)?\(([^)]*)\)\s*REFERENCES\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))*)\s*(?:\(([^)]*)\))?([\s\S]*)$/i.exec(rest);
    const actions = (tail: string, kind: "DELETE" | "UPDATE"): string | undefined => {
      const a = new RegExp(`ON\\s+${kind}\\s+(CASCADE|SET\\s+NULL|SET\\s+DEFAULT|RESTRICT|NO\\s+ACTION)`, "i").exec(tail)?.[1]?.toUpperCase().replace(/\s+/g, " ");
      return a === "CASCADE" ? "cascade" : a === "SET NULL" ? "setNull" : a === "SET DEFAULT" ? "setDefault" : a === "RESTRICT" ? "restrict" : a === "NO ACTION" ? "noAction" : undefined;
    };
    if (pk) {
      const ids = idList(pk[1]).map((c) => colIdByName(t, c)).filter((x): x is string => !!x);
      if (ids.length === 1) { const col = t.columns.find((c) => c.id === ids[0])!; col.primaryKey = true; col.notNull = true; }
      else if (ids.length > 1) { for (const id of ids) t.columns.find((c) => c.id === id)!.notNull = true; t.constraints.push({ id: `pk-${++cseq}`, kind: "primaryKey", columnIds: ids, ...(nameHint ? { physicalName: toPhysicalName(nameHint).name } : {}) }); }
    } else if (uq) {
      const ids = idList(uq[2]).map((c) => colIdByName(t, c)).filter((x): x is string => !!x);
      if (ids.length === 1) t.columns.find((c) => c.id === ids[0])!.unique = true;
      else if (ids.length > 1) t.constraints.push({ id: `uq-${++cseq}`, kind: "unique", columnIds: ids, ...((nameHint ?? (uq[1] ? unquote(uq[1]) : undefined)) ? { physicalName: toPhysicalName((nameHint ?? unquote(uq[1]!))).name } : {}) });
    } else if (fk) {
      const own = idList(fk[1]).map((c) => colIdByName(t, c));
      const refTable = objName(fk[2]);
      const refCols = fk[3] ? idList(fk[3]) : [];
      if (own.some((x) => !x)) { warnings.push(`テーブル「${t.physicalName}」の外部キーの列が見つかりません。読み飛ばしました`); return; }
      // 参照先の列の id は、参照先のテーブルを読み終えたあとで決める (ここでは、列の物理名から作る仮の印)
      t.constraints.push({ id: `fk-${++cseq}`, kind: "foreignKey", columnIds: own as string[], referencedTableId: kebab(toPhysicalName(refTable).name), referencedColumnIds: refCols.map((c) => `@${toPhysicalName(c).name}`), ...(nameHint ? { physicalName: toPhysicalName(nameHint).name } : {}), ...(actions(fk[4], "DELETE") ? { onDelete: actions(fk[4], "DELETE") } : {}), ...(actions(fk[4], "UPDATE") ? { onUpdate: actions(fk[4], "UPDATE") } : {}) });
    } else if (/^CHECK\b/i.test(rest)) {
      skipped.push(`テーブル「${t.physicalName}」の CHECK 制約 (式は取り込みません)`);
    } else if (/^(KEY|INDEX|FULLTEXT|SPATIAL)\b/i.test(rest)) {
      const m = /^(?:KEY|INDEX)\s*("[^"]+"|`[^`]+`|\w+)?\s*\(([^)]*)\)/i.exec(rest);
      if (m) {
        const ids = idList(m[2]).map((c) => colIdByName(t, c)).filter((x): x is string => !!x);
        if (ids.length) t.indexes.push({ id: `idx-${++cseq}`, physicalName: toPhysicalName(m[1] ? unquote(m[1]) : `idx_${t.physicalName}_${cseq}`).name, columns: ids.map((columnId) => ({ columnId })) });
      } else skipped.push(`テーブル「${t.physicalName}」のインデックス (${rest.slice(0, 40)})`);
    } else skipped.push(`テーブル「${t.physicalName}」の制約 (${rest.slice(0, 40)})`);
  };

  for (const st of statements) {
    const head = /^CREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))*)\s*\(/i.exec(st);
    if (head) {
      const open = st.indexOf("(", head.index + head[0].length - 1);
      let depth = 0, end = -1;
      for (let i = open; i < st.length; i++) {
        const c = st[i];
        if (c === "'" || c === '"' || c === "`") { let j = i + 1; while (j < st.length && st[j] !== c) { if (st[j] === "\\" && c === "'") j++; j++; } i = j; continue; }
        if (c === "(") depth++; else if (c === ")") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) { skipped.push(`CREATE TABLE ${head[1]} (閉じていません)`); continue; }
      const originalName = objName(head[1]);
      const phys = toPhysicalName(originalName);
      if (phys.changed) warnings.push(`テーブル名「${originalName}」を物理名「${phys.name}」にしました`);
      const tableTail = st.slice(end + 1);
      const tableComment = /COMMENT\s*=?\s*('(?:[^']|'')*')/i.exec(tableTail)?.[1];
      const t: ImportedTable = { id: kebab(phys.name), physicalName: phys.name, name: tableComment ? stringLiteral(tableComment) : phys.name, ...(tableComment ? { comment: stringLiteral(tableComment) } : {}), columns: [], indexes: [], constraints: [] };
      const defs = splitTop(st.slice(open + 1, end));
      const tableLevel: string[] = [];
      for (const def of defs) {
        if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|KEY|INDEX|FULLTEXT|SPATIAL|EXCLUDE|LIKE|PERIOD)\b/i.test(def)) { tableLevel.push(def); continue; }
        const raw = splitColumnDef(def);
        if (!raw) { skipped.push(`テーブル「${t.physicalName}」の定義 (${def.slice(0, 40)})`); continue; }
        const cp = toPhysicalName(raw.name);
        if (cp.changed) warnings.push(`列名「${t.physicalName}.${raw.name}」を物理名「${cp.name}」にしました`);
        if (t.columns.some((c) => c.physicalName === cp.name)) { warnings.push(`列名「${cp.name}」が重複しています。2 つ目は読み飛ばしました`); continue; }
        const ty = mapType(raw.typeText);
        const rest = raw.rest;
        const col: ImportedColumn = { id: `col-${cp.name.replace(/_/g, "-")}`, no: t.columns.length + 1, physicalName: cp.name, name: raw.name, dataType: ty.dataType };
        if (ty.length !== undefined) col.length = ty.length;
        if (ty.scale !== undefined) col.scale = ty.scale;
        if (!ty.mapped) warnings.push(`型「${ty.original}」(${t.physicalName}.${cp.name}) は、スキーマの型にないため ${ty.dataType} にしました (元の型は備考に残しました)`);
        if (/\bNOT\s+NULL\b/i.test(rest)) col.notNull = true;
        if (/\bPRIMARY\s+KEY\b/i.test(rest)) { col.primaryKey = true; col.notNull = true; }
        if (/\bUNIQUE\b/i.test(rest) && !col.primaryKey) col.unique = true;
        if (ty.serial || /\b(AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY)\b/i.test(rest)) { col.autoIncrement = true; col.notNull = true; }
        const def2 = /\bDEFAULT\s+((?:'(?:[^']|'')*')|(?:[\w.]+\([^)]*\))|(?:[^\s,]+))/i.exec(rest);
        if (def2 && !ty.serial) col.defaultValue = def2[1];
        const cm = /\bCOMMENT\s+('(?:[^']|'')*')/i.exec(rest)?.[1];
        const notes = [cm ? stringLiteral(cm) : "", ty.mapped ? "" : `元の型: ${ty.original}`].filter(Boolean).join(" / ");
        if (cm) col.name = stringLiteral(cm).slice(0, 60) || raw.name;
        if (notes) col.comment = notes;
        const inlineRef = /\bREFERENCES\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))*)\s*(?:\(([^)]*)\))?([\s\S]*)$/i.exec(rest);
        t.columns.push(col);
        if (inlineRef) tableLevel.push(`FOREIGN KEY (${raw.name}) REFERENCES ${inlineRef[1]}${inlineRef[2] ? `(${inlineRef[2]})` : ""}${inlineRef[3] ?? ""}`);
      }
      for (const def of tableLevel) {
        const cons = /^CONSTRAINT\s+("[^"]+"|`[^`]+`|\w+)\s+([\s\S]*)$/i.exec(def);
        addConstraint(t, cons ? cons[2].trim() : def, cons ? unquote(cons[1]) : undefined);
      }
      if (byPhysical.has(t.physicalName)) { warnings.push(`テーブル「${t.physicalName}」が重複しています。2 つ目は読み飛ばしました`); continue; }
      byPhysical.set(t.physicalName, t);
      tables.push(t);
      continue;
    }
    const idx = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))*)\s+ON\s+(?:ONLY\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))*)\s*(?:USING\s+(\w+)\s*)?\(([^)]*)\)/i.exec(st);
    if (idx) {
      const t = findTable(idx[3]);
      if (!t) { skipped.push(`インデックス ${objName(idx[2])} (テーブルが見つかりません)`); continue; }
      const ids = idList(idx[5]).map((c) => colIdByName(t, c)).filter((x): x is string => !!x);
      if (!ids.length) { skipped.push(`インデックス ${objName(idx[2])} (式のインデックス)`); continue; }
      const method = idx[4]?.toLowerCase();
      t.indexes.push({ id: `idx-${++cseq}`, physicalName: toPhysicalName(objName(idx[2])).name, columns: ids.map((columnId) => ({ columnId })), ...(idx[1] ? { unique: true } : {}), ...(method && ["btree", "hash", "gin", "gist"].includes(method) ? { method } : {}) } as ImportedTable["indexes"][number]);
      continue;
    }
    const alter = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))*)\s+ADD\s+([\s\S]*)$/i.exec(st);
    if (alter) {
      const t = findTable(alter[1]);
      if (!t) { skipped.push(`ALTER TABLE ${objName(alter[1])} (テーブルが見つかりません)`); continue; }
      const body = alter[2].replace(/^COLUMN\s+/i, "");
      if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN)\b/i.test(body)) {
        const cons = /^CONSTRAINT\s+("[^"]+"|`[^`]+`|\w+)\s+([\s\S]*)$/i.exec(body);
        addConstraint(t, cons ? cons[2].trim() : body, cons ? unquote(cons[1]) : undefined);
      } else skipped.push(`ALTER TABLE ${t.physicalName} ADD ${body.slice(0, 40)}`);
      continue;
    }
    const cmt = /^COMMENT\s+ON\s+(TABLE|COLUMN)\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|[\w$]+))*)\s+IS\s+('(?:[^']|'')*'|NULL)$/i.exec(st);
    if (cmt) {
      const text = cmt[3].toUpperCase() === "NULL" ? "" : stringLiteral(cmt[3]);
      if (cmt[1].toUpperCase() === "TABLE") { const t = findTable(cmt[2]); if (t && text) { t.name = text.slice(0, 100); t.comment = text; } }
      else {
        const parts = cmt[2].split(".").map(unquote);
        const t = findTable(parts.slice(0, -1).join(".") || parts[0]);
        const c = t?.columns.find((x) => x.physicalName === toPhysicalName(parts[parts.length - 1]).name);
        if (c && text) { c.name = text.slice(0, 60); c.comment = c.comment ? `${text} / ${c.comment}` : text; }
      }
      continue;
    }
    if (/^(SET|SELECT|CREATE\s+(EXTENSION|SCHEMA|SEQUENCE|TYPE|DOMAIN|FUNCTION|OR\s+REPLACE|TRIGGER|VIEW|MATERIALIZED)|ALTER\s+(TABLE|SEQUENCE|SCHEMA|TYPE)\b.*(OWNER|OWNED|SET|ATTACH)|DROP|LOCK|UNLOCK|USE|BEGIN|COMMIT|START|GRANT|REVOKE|INSERT|COPY|SELECT|DELIMITER|PRAGMA)\b/i.test(st)) {
      if (/^(CREATE\s+(TRIGGER|VIEW|FUNCTION|OR\s+REPLACE|MATERIALIZED|TYPE|DOMAIN))/i.test(st)) skipped.push(st.slice(0, 60).replace(/\s+/g, " "));
      continue;
    }
    if (st.length) skipped.push(st.slice(0, 60).replace(/\s+/g, " "));
  }

  // 外部キーの参照先の列を、参照先のテーブルの列 id に直す (省略されていれば、参照先の主キー)
  for (const t of tables) {
    t.constraints = t.constraints.flatMap((c) => {
      if (c.kind !== "foreignKey") return [c];
      const ref = tables.find((x) => x.id === c.referencedTableId);
      if (!ref) { warnings.push(`テーブル「${t.physicalName}」の外部キーの参照先 (${String(c.referencedTableId)}) が、取り込む DDL にありません。読み飛ばしました`); return []; }
      const marks = c.referencedColumnIds as string[];
      const ids = marks.length ? marks.map((m) => ref.columns.find((x) => x.physicalName === m.slice(1))?.id) : ref.columns.filter((x) => x.primaryKey).map((x) => x.id);
      if (!ids.length || ids.some((x) => !x) || ids.length !== (c.columnIds as string[]).length) { warnings.push(`テーブル「${t.physicalName}」の外部キーの参照先の列を決められません。読み飛ばしました`); return []; }
      return [{ ...c, referencedColumnIds: ids }];
    });
  }
  return { tables, warnings, skipped };
}
