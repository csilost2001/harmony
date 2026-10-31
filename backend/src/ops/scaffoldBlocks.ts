/**
 * 開発コンテナの雛形 (NestJS 系) の「DB ごとのブロック」を、アプリの techStack に合わせて消す規則 (#1560)。
 *
 * 雛形のファイル (docker-compose.yml・.devcontainer/*・Dockerfile・README.snippet.md) には、`techStack.database.type` と
 * `techStack.backend.orm` ごとのブロック (`# @db <種別>` … `# @end-db`、`# @orm <名前>` … `# @end-orm`) が全部入っている。
 * 写すとき (generate-code の SKILL.md「DB ごとのブロック」) は、合うブロックを残し、合わないブロックを中身ごと消す。
 * **この規則はここだけに持つ**。雛形の更新の比較 (scaffold.ts) と、雛形の検査 (generateCodeDbBlocks.test.ts) が同じ関数を使う。
 *
 * もう 1 つの規則 (規則 7、#1587): 雛形の `__DB_VERSION__` は、`techStack.database.version` (DB の image のタグ) に置き換える。
 * 版は DB ごとの既定 (postgresql 15 / mysql 8) があり、image のタグに入る値なので、数字とドットだけの形でない値は既定に戻す。
 */
import fs from "node:fs/promises";
import path from "node:path";

/** techStack.database.type の既定 (schema の default) */
export const DEFAULT_DB = "postgresql";
/** techStack.backend.orm の既定 (schema の default。推奨) */
export const DEFAULT_ORM = "prisma";

/** techStack.database.version の既定 (DB の image のタグ。雛形に DB サービスがある DB だけ) */
export const DEFAULT_DB_VERSIONS: Readonly<Record<string, string>> = { postgresql: "15", mysql: "8" };
/** 雛形の中で、DB の版に置き換える印 (規則 7) */
export const DB_VERSION_TOKEN = "__DB_VERSION__";
/** DB の版として通す形 (image のタグに入るので、任意の文字列は通さない) */
const DB_VERSION_FORM = /^[0-9]+(?:\.[0-9]+)*$/;

/** dbVersion は省略できる (省略、または形が合わないときは、DB ごとの既定) */
export interface BlockContext { db: string; orm: string; dbVersion?: string }

/** harmony.json の database.version (生の値) から、使う版を決める。文字列で、数字とドットだけの形のときだけ通し、それ以外は DB ごとの既定 (雛形に DB サービスが無い DB は、指定があっても undefined) */
export function resolveDbVersion(db: string, raw: unknown): string | undefined {
  const dflt = DEFAULT_DB_VERSIONS[db.toLowerCase()];
  if (dflt === undefined) return undefined; // 雛形に DB サービスが無い DB (sqlite・sqlserver・oracle) は、版を使わない
  if (typeof raw === "string" && DB_VERSION_FORM.test(raw.trim())) return raw.trim();
  return dflt;
}

const OPEN = /^(?:#|\/\/|<!--)\s*@(db|orm)\s+([a-z0-9,]+)\s*(?:-->)?$/i;
const CLOSE = /^(?:#|\/\/|<!--)\s*@end-(db|orm)\s*(?:-->)?$/i;
/** ブロックのマーカー行が残っているかを見る正規表現 */
export const BLOCK_MARKER_LINE = /^\s*(?:#|\/\/|<!--)\s*@(?:db|orm|end-db|end-orm)\b/im;

/**
 * 規則 1〜5: 一致するブロックはマーカー行だけ消して中身を残し、一致しないブロックはマーカー行と中身を消す。
 * ブロックは入れ子になる (外側が一致しなければ内側ごと消える)。マーカーの行以外は変えない。種類 (`db` / `orm`) と名前は大文字小文字を区別しない。
 * 開始と終了が対応しない (数が合わない・種類が違う) ときは Error。
 */
export function pruneScaffoldBlocks(text: string, ctx: BlockContext): string {
  const out: string[] = [];
  const stack: { kind: string; keep: boolean }[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    const open = t.match(OPEN);
    if (open) {
      const kind = open[1].toLowerCase();
      stack.push({ kind, keep: open[2].toLowerCase().split(",").includes((kind === "db" ? ctx.db : ctx.orm).toLowerCase()) });
      continue;
    }
    const close = t.match(CLOSE);
    if (close) {
      const top = stack.pop();
      if (!top) throw new Error("終了マーカーが多い");
      if (top.kind !== close[1].toLowerCase()) throw new Error(`開始マーカー (@${top.kind}) と終了マーカー (@end-${close[1].toLowerCase()}) の種類が違う`);
      continue;
    }
    if (stack.every((b) => b.keep)) out.push(line);
  }
  if (stack.length !== 0) throw new Error("開始マーカーに終了マーカーが無い");
  return out.join("\n");
}

/** compose.yml で、中身が空になると「値の無いキー」になる 2 つ (DB のブロックが全部消える sqlserver / oracle で起きる) */
const EMPTYABLE_KEYS = /^(\s*)(environment|volumes):\s*$/;

/**
 * 規則 6: ブロックを消した結果、子の行が 1 つも無い `environment:` / `volumes:` の行を消す (YAML のファイルだけ)。
 * 子の行 = そのキーより深いインデントの、空でもコメントでもない行 (YAML では、同じインデントの `- ` で始まる行も、そのキーの子)
 */
export function dropEmptyComposeKeys(text: string): string {
  const lines = text.split("\n");
  const drop = new Set<number>();
  lines.forEach((line, i) => {
    const m = line.match(EMPTYABLE_KEYS);
    if (!m) return;
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "" || t.startsWith("#")) continue;
      const ind = lines[j].length - lines[j].trimStart().length;
      if (ind > indent || (ind === indent && t.startsWith("- "))) return; // 子がある
      break;
    }
    drop.add(i);
  });
  return drop.size ? lines.filter((_, i) => !drop.has(i)).join("\n") : text;
}

/** 規則 7: `__DB_VERSION__` を DB の版に置き換える (全ファイル)。ctx.dbVersion が無い・形が合わないときは DB ごとの既定。既定の無い DB (sqlite など) は置き換えない (印はブロックの中にしか無いので、残らない) */
export function applyDbVersion(text: string, ctx: BlockContext): string {
  const v = resolveDbVersion(ctx.db, ctx.dbVersion);
  return v === undefined ? text : text.split(DB_VERSION_TOKEN).join(v);
}

/** 雛形のファイル 1 つに規則 1〜7 を当てる (YAML の規則 6 は YAML だけ)。ブロックが壊れているときは Error */
export function pruneScaffoldFile(relPath: string, text: string, ctx: BlockContext): string {
  const pruned = applyDbVersion(pruneScaffoldBlocks(text, ctx), ctx);
  return /\.ya?ml$/i.test(relPath) ? dropEmptyComposeKeys(pruned) : pruned;
}

/** ブロックが壊れていても止めない版 (更新の比較用)。壊れていれば、消さずにそのまま返す */
export function pruneScaffoldFileSafe(relPath: string, text: string, ctx: BlockContext): string {
  try { return pruneScaffoldFile(relPath, text, ctx); } catch { return text; }
}

/** harmony.json の techStack から、ブロックを選ぶ値 (database.type は省略時 postgresql、backend.orm は省略時 prisma) と DB の版 (database.version。省略・不正は DB ごとの既定)。読めなければ既定 */
export async function blockContextOf(root: string): Promise<BlockContext> {
  try {
    const hj: unknown = JSON.parse(await fs.readFile(path.join(root, "harmony.json"), "utf-8"));
    const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
    const ts = rec(rec(hj)?.techStack);
    const pick = (v: unknown, dflt: string): string => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : dflt);
    const database = rec(ts?.database);
    const db = pick(database?.type, DEFAULT_DB);
    return { db, orm: pick(rec(ts?.backend)?.orm, DEFAULT_ORM), dbVersion: resolveDbVersion(db, database?.version) };
  } catch { return { db: DEFAULT_DB, orm: DEFAULT_ORM, dbVersion: DEFAULT_DB_VERSIONS[DEFAULT_DB] }; }
}
