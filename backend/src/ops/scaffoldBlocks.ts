/**
 * 開発コンテナの雛形 (NestJS 系) の「DB ごとのブロック」を、アプリの techStack に合わせて消す規則 (#1560)。
 *
 * 雛形のファイル (docker-compose.yml・.devcontainer/*・Dockerfile・README.snippet.md) には、`techStack.database.type` と
 * `techStack.backend.orm` ごとのブロック (`# @db <種別>` … `# @end-db`、`# @orm <名前>` … `# @end-orm`) が全部入っている。
 * 写すとき (generate-code の SKILL.md「DB ごとのブロック」) は、合うブロックを残し、合わないブロックを中身ごと消す。
 * **この規則はここだけに持つ**。雛形の更新の比較 (scaffold.ts) と、雛形の検査 (generateCodeDbBlocks.test.ts) が同じ関数を使う。
 */
import fs from "node:fs/promises";
import path from "node:path";

/** techStack.database.type の既定 (schema の default) */
export const DEFAULT_DB = "postgresql";
/** techStack.backend.orm の既定 (schema の default。推奨) */
export const DEFAULT_ORM = "prisma";

export interface BlockContext { db: string; orm: string }

const OPEN = /^(?:#|\/\/|<!--)\s*@(db|orm)\s+([a-z0-9,]+)\s*(?:-->)?$/;
const CLOSE = /^(?:#|\/\/|<!--)\s*@end-(db|orm)\s*(?:-->)?$/;
/** ブロックのマーカー行が残っているかを見る正規表現 */
export const BLOCK_MARKER_LINE = /^\s*(?:#|\/\/|<!--)\s*@(?:db|orm|end-db|end-orm)\b/m;

/**
 * 規則 1〜5: 一致するブロックはマーカー行だけ消して中身を残し、一致しないブロックはマーカー行と中身を消す。
 * ブロックは入れ子になる (外側が一致しなければ内側ごと消える)。マーカーの行以外は変えない。開始と終了が対応しないときは Error。
 */
export function pruneScaffoldBlocks(text: string, ctx: BlockContext): string {
  const out: string[] = [];
  const stack: boolean[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    const open = t.match(OPEN);
    if (open) { stack.push(open[2].split(",").includes(ctx[open[1] as keyof BlockContext])); continue; }
    if (CLOSE.test(t)) {
      if (stack.length === 0) throw new Error("終了マーカーが多い");
      stack.pop();
      continue;
    }
    if (stack.every(Boolean)) out.push(line);
  }
  if (stack.length !== 0) throw new Error("開始マーカーに終了マーカーが無い");
  return out.join("\n");
}

/** compose.yml で、中身が空になると「値の無いキー」になる 2 つ (DB のブロックが全部消える sqlserver / oracle で起きる) */
const EMPTYABLE_KEYS = /^(\s*)(environment|volumes):\s*$/;

/**
 * 規則 6: ブロックを消した結果、子の行が 1 つも無い `environment:` / `volumes:` の行を消す (YAML のファイルだけ)。
 * 子の行 = そのキーより深いインデントの、空でもコメントでもない行
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
      if (ind > indent) return; // 子がある
      break;
    }
    drop.add(i);
  });
  return drop.size ? lines.filter((_, i) => !drop.has(i)).join("\n") : text;
}

/** 雛形のファイル 1 つに規則 1〜6 を当てる (YAML は規則 6 まで)。ブロックが壊れているときは Error */
export function pruneScaffoldFile(relPath: string, text: string, ctx: BlockContext): string {
  const pruned = pruneScaffoldBlocks(text, ctx);
  return /\.ya?ml$/i.test(relPath) ? dropEmptyComposeKeys(pruned) : pruned;
}

/** ブロックが壊れていても止めない版 (更新の比較用)。壊れていれば、消さずにそのまま返す */
export function pruneScaffoldFileSafe(relPath: string, text: string, ctx: BlockContext): string {
  try { return pruneScaffoldFile(relPath, text, ctx); } catch { return text; }
}

/** harmony.json の techStack から、ブロックを選ぶ値 (database.type は省略時 postgresql、backend.orm は省略時 prisma)。読めなければ既定 */
export async function blockContextOf(root: string): Promise<BlockContext> {
  try {
    const hj: unknown = JSON.parse(await fs.readFile(path.join(root, "harmony.json"), "utf-8"));
    const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
    const ts = rec(rec(hj)?.techStack);
    const pick = (v: unknown, dflt: string): string => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : dflt);
    return { db: pick(rec(ts?.database)?.type, DEFAULT_DB), orm: pick(rec(ts?.backend)?.orm, DEFAULT_ORM) };
  } catch { return { db: DEFAULT_DB, orm: DEFAULT_ORM }; }
}
