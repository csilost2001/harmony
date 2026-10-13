#!/usr/bin/env node
/**
 * types-drift — スキーマ (schemas/v3/*.json) と、手書きの TypeScript の型 (frontend/src/types/v3/*.ts) の、項目の食い違いを検出する。
 *
 * 型は手書きで、スキーマとの乖離は、人が気づくしかなかった。同じ名前 ($defs の名前 = interface の名前) の組について、
 * スキーマの `properties` の項目名と、interface の項目名 (extends した interface・index signature を含む) を比べる:
 *   - スキーマにあるのに、型に無い項目 (型の側の追従漏れ)
 *   - 型にあるのに、スキーマに無い項目 (スキーマに無い項目を、型が出している)
 * 既存の食い違いは scripts/verify/types-drift.baseline.json に記録してある (一覧は、直したら減らす)。新しい食い違いは、失敗にする。
 * スキーマそのものは、設計者の専権 (AGENTS.md)。この検査は、型の側を直すか、食い違いを意図して baseline に足す (理由を PR に書く)ためのもの。
 *
 * 使い方: node scripts/verify/types-drift.mjs [--update-baseline] [--list]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require(path.join(root, "node_modules", "typescript"));
const schemasDir = path.join(root, "schemas", "v3");
const typesDir = path.join(root, "frontend", "src", "types", "v3");
const baselineFile = path.join(root, "scripts", "verify", "types-drift.baseline.json");

// ── 型 (interface) の項目 ───────────────────────────────────────────────
const interfaces = new Map(); // name -> { members:Set, extends:[names], indexSignature:bool, file }
for (const f of fs.readdirSync(typesDir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
  const src = ts.createSourceFile(f, fs.readFileSync(path.join(typesDir, f), "utf8"), ts.ScriptTarget.Latest, true);
  src.forEachChild((node) => {
    if (!ts.isInterfaceDeclaration(node)) return;
    const members = new Set();
    let index = false;
    for (const m of node.members) {
      if (ts.isIndexSignatureDeclaration(m)) index = true;
      else if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) members.add(m.name.text);
    }
    const ext = (node.heritageClauses ?? []).flatMap((h) => h.types.map((t) => t.expression.getText(src)));
    interfaces.set(node.name.text, { members, extends: ext, indexSignature: index, file: f });
  });
}
function allMembers(name, seen = new Set()) {
  const i = interfaces.get(name);
  if (!i || seen.has(name)) return { members: new Set(), index: false, known: !!i };
  seen.add(name);
  const out = new Set(i.members);
  let index = i.indexSignature;
  for (const e of i.extends) { const b = allMembers(e, seen); b.members.forEach((m) => out.add(m)); index ||= b.index; }
  return { members: out, index, known: true };
}

// ── スキーマ ($defs) の項目 ──────────────────────────────────────────────
function schemaProps(def, defs, depth = 0) {
  const props = new Set();
  if (!def || depth > 4) return props;
  for (const k of Object.keys(def.properties ?? {})) props.add(k);
  for (const part of def.allOf ?? []) {
    if (part.$ref) {
      const name = part.$ref.split("/").pop();
      const target = part.$ref.startsWith("#") ? defs[name] : null;
      if (target) schemaProps(target, defs, depth + 1).forEach((p) => props.add(p));
      else if (part.$ref.includes("common.v3.schema.json")) { /* EntityMeta など。共通の項目は、型の側で extends している */ }
    } else schemaProps(part, defs, depth + 1).forEach((p) => props.add(p));
  }
  return props;
}

const found = {}; // "schema#Def" -> { missing:[], extra:[] }
let compared = 0;
for (const f of fs.readdirSync(schemasDir).filter((x) => x.endsWith(".v3.schema.json"))) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, f), "utf8"));
  const defs = schema.$defs ?? {};
  for (const [name, def] of Object.entries(defs)) {
    if (def.type !== "object" && !def.properties && !def.allOf) continue;
    if (!interfaces.has(name)) continue;
    const sp = schemaProps(def, defs);
    if (sp.size === 0) continue;
    compared++;
    const ts_ = allMembers(name);
    // allOf で共通 (common.v3.schema.json) の項目を取り込む定義は、型の側の extends が持つので、スキーマ側の列挙に無い項目は「余分」にしない
    const usesCommon = (def.allOf ?? []).some((p) => p.$ref && !p.$ref.startsWith("#"));
    const missing = [...sp].filter((p) => !ts_.members.has(p) && !ts_.index);
    const extra = usesCommon || def.additionalProperties !== false ? [] : [...ts_.members].filter((p) => !sp.has(p));
    if (missing.length || extra.length) found[`${f}#${name}`] = { ...(missing.length ? { missing } : {}), ...(extra.length ? { extra } : {}) };
  }
}

const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) : {};
if (process.argv.includes("--update-baseline")) { fs.writeFileSync(baselineFile, JSON.stringify(found, null, 2) + "\n"); console.log(`baseline を更新しました (${Object.keys(found).length} 件)`); process.exit(0); }
if (process.argv.includes("--list")) { console.log(JSON.stringify(found, null, 2)); }

const fresh = [];
for (const [k, v] of Object.entries(found)) {
  const b = baseline[k] ?? {};
  const miss = (v.missing ?? []).filter((x) => !(b.missing ?? []).includes(x));
  const ext = (v.extra ?? []).filter((x) => !(b.extra ?? []).includes(x));
  if (miss.length) fresh.push(`${k}: スキーマにあるのに、型に無い項目: ${miss.join(", ")}`);
  if (ext.length) fresh.push(`${k}: 型にあるのに、スキーマに無い項目: ${ext.join(", ")}`);
}
const fixed = [];
for (const [k, b] of Object.entries(baseline)) {
  const v = found[k] ?? {};
  const gone = [...(b.missing ?? []).filter((x) => !(v.missing ?? []).includes(x)), ...(b.extra ?? []).filter((x) => !(v.extra ?? []).includes(x))];
  if (gone.length) fixed.push(`${k}: ${gone.join(", ")}`);
}
console.log(`スキーマと型の食い違い: ${Object.keys(found).length} 定義 (比べた組 ${compared} / baseline ${Object.keys(baseline).length} 定義)`);
if (compared < 20) { console.error("比べた組が少なすぎます (名前の対応づけが壊れていないか確かめてください)"); process.exit(1); }
if (fixed.length) console.log(`直った (baseline から外せる。--update-baseline):\n  ${fixed.join("\n  ")}`);
if (fresh.length) { console.error(`新しい食い違い:\n  ${fresh.join("\n  ")}`); process.exit(1); }
