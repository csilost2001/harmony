#!/usr/bin/env node
/**
 * 資料の中の JSON の例を、スキーマで検査する。例が古くなって、スキーマに合わなくなるのを止める。
 *
 * 印: 検査したい ```json のコードブロックの直前の行に、HTML コメントで検査先を書く。
 *   <!-- schema: process-flow#/$defs/Step -->
 *   ```json
 *   { "id": "step-01", "kind": "compute", ... }
 *   ```
 * `<ファイル名>#<JSON ポインタ>` の形。ファイル名は schemas/v3/<ファイル名>.v3.schema.json、# 以降を省くと、そのスキーマの全体。
 * 印のないコードブロックは検査しない (断片・省略記号つきの例が多く、検査先を機械で決められないため)。
 * 検査するのは docs/ 配下と ai-skills/ 配下の Markdown。使い方: node scripts/docs/json-examples.mjs   (npm run check:docs に含まれる)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MARK = /^<!--\s*schema:\s*([A-Za-z0-9._-]+)(#[^\s]*)?\s*-->\s*$/;

function mdFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "html") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) mdFiles(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

/** 印つきのコードブロックを集める */
export function collectExamples(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = MARK.exec(lines[i].trim());
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (!/^```json\s*$/.test(lines[j] ?? "")) { out.push({ line: i + 1, schema: m[1], pointer: m[2] ?? "", error: "印の次が ```json のコードブロックではありません" }); continue; }
    const body = [];
    let k = j + 1;
    while (k < lines.length && !/^```\s*$/.test(lines[k])) body.push(lines[k++]);
    out.push({ line: i + 1, schema: m[1], pointer: m[2] ?? "", body: body.join("\n") });
  }
  return out;
}

export function checkJsonExamples(base = root) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, discriminator: true });
  addFormats(ajv);
  const dir = path.join(base, "schemas/v3");
  const ids = new Map();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".schema.json"))) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (s.$id && !ajv.getSchema(s.$id)) ajv.addSchema(s);
    ids.set(f.replace(/\.v3\.schema\.json$/, ""), s.$id);
  }
  const problems = [];
  let checked = 0;
  for (const file of [...mdFiles(path.join(base, "docs")), ...mdFiles(path.join(base, "ai-skills"))]) {
    const rel = path.relative(base, file);
    for (const ex of collectExamples(fs.readFileSync(file, "utf8"))) {
      const where = `${rel}:${ex.line}`;
      if (ex.error) { problems.push(`${where}: ${ex.error}`); continue; }
      const id = ids.get(ex.schema);
      if (!id) { problems.push(`${where}: スキーマ「${ex.schema}」がありません`); continue; }
      let data;
      try { data = JSON.parse(ex.body); } catch (e) { problems.push(`${where}: JSON として読めません (${e.message})`); continue; }
      const validate = ajv.getSchema(`${id}${ex.pointer}`);
      if (!validate) { problems.push(`${where}: 検査先「${ex.schema}${ex.pointer}」がスキーマにありません`); continue; }
      checked++;
      if (!validate(data)) problems.push(`${where}: スキーマ ${ex.schema}${ex.pointer} に合いません — ${(validate.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || "(全体)"} ${e.message}`).join(" / ")}`);
    }
  }
  return { problems, checked };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, checked } = checkJsonExamples();
  for (const p of problems) console.error(`✗ ${p}`);
  console.log(`印つきの JSON の例 ${checked} 件を検査: 食い違い ${problems.length} 件`);
  process.exit(problems.length ? 1 : 0);
}
