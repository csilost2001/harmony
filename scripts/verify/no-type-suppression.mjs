#!/usr/bin/env node
/**
 * no-type-suppression — 型検査を止める指示 (`@ts-nocheck` / `@ts-ignore` / `@ts-expect-error`) を、テスト以外に置かない。
 * 型が付けられないときは、`unknown` + 型ガード、または型を足す。指示で黙らせると、そのファイルの型の保護が外れる。
 * 注意: コメントの中の説明 (「@ts-nocheck 除去」など) は、行頭のコメントの指示の形だけを数える。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIRECTIVE = /^\s*(\/\/|\/\*+|\*)\s*@ts-(nocheck|ignore|expect-error)\b/;
const hits = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx|mts|mjs)$/.test(e.name) || /\.test\.tsx?$|\.d\.ts$/.test(e.name)) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => { if (DIRECTIVE.test(line)) hits.push(`${path.relative(root, p)}:${i + 1}: ${line.trim()}`); });
  }
}
for (const d of ["frontend/src", "backend/src", "shared/src", "scripts"]) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
if (hits.length) {
  console.error(`型検査を止める指示が ${hits.length} 件あります (テスト以外には置かない):\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("型検査を止める指示: 0 件");
