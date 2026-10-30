/**
 * 資料 (docs/spec・schemas/v3・ai-skills など) を同梱するディレクトリの場所。MCP の Resources (mcpKnowledge.ts) と、開発コンテナの雛形 (ops/scaffold.ts) が共有する。
 * 小さな module に分けてあるのは、どちらからも循環なしで import するため。`import.meta.url` からの相対 (`../..`) を使うので、backend/src 直下に置く。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 同じ警告は 1 回だけ出す (点検など、頻繁に呼ぶ側が毎回ログを埋めないように) */
const warned = new Set<string>();

/** 資料を同梱するディレクトリ (リポジトリの根)。HARMONY_DOCS_DIR で変えられる。docs/AI-INDEX.md と schemas/v3 がある場所 */
export function findDocsRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  if (env.HARMONY_DOCS_DIR?.trim()) candidates.push(path.resolve(env.HARMONY_DOCS_DIR.trim()));
  const here = path.dirname(fileURLToPath(import.meta.url)); // backend/src または backend/dist
  candidates.push(path.resolve(here, "../.."), path.resolve(process.cwd(), ".."), process.cwd());
  const found = candidates.find((d) => fs.existsSync(path.join(d, "schemas/v3")) && fs.existsSync(path.join(d, "docs/spec"))) ?? null;
  if (env.HARMONY_DOCS_DIR?.trim() && found !== path.resolve(env.HARMONY_DOCS_DIR.trim())) {
    const msg = `[MCP] HARMONY_DOCS_DIR=${env.HARMONY_DOCS_DIR} に schemas/v3 と docs/spec がありません。${found ?? "資料なし"} を使います`;
    if (!warned.has(msg)) { warned.add(msg); console.error(msg); }
  }
  return found;
}
