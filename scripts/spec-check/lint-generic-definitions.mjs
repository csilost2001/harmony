#!/usr/bin/env node
// Soft lint for `<project>/<dataDir>/generic-definitions/<kind>/*.json` 配下の
// generic-definition entity を、AJV strict gate と併用する最小限の前段 check。
//
// 役割分担 (#1063 で AJV strict gate 導入後):
//   - 本 script (soft lint): physical path ↔ JSON kind field 一致 / 最低 5 field 存在 /
//     最低限の enum / type check。fixture-free で project ディレクトリ全体を walk する。
//     CLI から `npm run lint:samples` 等で個別 project に対して即時実行できる軽量 gate。
//   - AJV strict gate (scripts/spec-check/test.mjs §3b): name pattern /
//     responsibilities minItems / relations[].kind enum / unevaluatedProperties: false
//     等の strict 検証。schema (schemas/v3/generic-definition.v3.schema.json) が正。
//
// 物理配置 (path ↔ kind 一致) は AJV 単体では検出できないため、本 soft lint を
// 維持する。両者を併用して silent failure を防ぐ。
//
// Usage:
//   node scripts/spec-check/lint-generic-definitions.mjs <project-dir>
//   node scripts/spec-check/lint-generic-definitions.mjs examples/retail
//
// Exit code: 0 = OK, 1 = error, 2 = nothing to lint

import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, basename, relative, sep } from "node:path";

const VALID_KINDS = new Set([
  "data-contract",
  "domain-type",
  "exception-type",
  "application-rule",
  "ui-behavior",
  "runtime-policy",
  "component-definition",
]);

const REQUIRED_FIELDS = ["kind", "name", "purpose", "responsibilities", "targets"];

const VALID_TARGETS = new Set(["backend", "frontend", "shared", "runtime"]);

function walkDir(dir, ext = ".json") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full, ext));
    else if (entry.isFile() && full.endsWith(ext)) out.push(full);
  }
  return out;
}

const projectDir = process.argv[2];
if (!projectDir) {
  console.error("Usage: lint-generic-definitions.mjs <project-dir>");
  console.error("Example: node scripts/spec-check/lint-generic-definitions.mjs examples/retail");
  process.exit(1);
}

// Resolve dataDir from <project>/harmony.json
// harmony.json 不在は error (silent fallback 禁止、壊れた project を "nothing to lint"
// と誤認しないため。skill 側 Step 0 と整合)
const harmonyJsonPath = resolve(projectDir, "harmony.json");
if (!existsSync(harmonyJsonPath)) {
  console.error(`Error: ${harmonyJsonPath} not found. lint requires a valid Harmony project (harmony.json must exist).`);
  process.exit(1);
}
let dataDir;
try {
  const harmonyJson = JSON.parse(readFileSync(harmonyJsonPath, "utf8"));
  if (typeof harmonyJson.dataDir !== "string" || harmonyJson.dataDir.length === 0) {
    console.error(`Error: ${harmonyJsonPath} has no valid \`dataDir\` field.`);
    process.exit(1);
  }
  dataDir = harmonyJson.dataDir;
} catch (e) {
  console.error(`Error: failed to parse ${harmonyJsonPath}: ${e.message}`);
  process.exit(1);
}

const gdRoot = resolve(projectDir, dataDir, "generic-definitions");
if (!existsSync(gdRoot)) {
  console.log(`No generic-definitions/ at ${gdRoot} — nothing to lint`);
  process.exit(2);
}

const files = walkDir(gdRoot);
console.log(`Linting ${files.length} generic-definition JSON files under ${gdRoot}`);
console.log();

// 空 dir は silent pass せず明示 (status=2 = nothing to lint で diff)
if (files.length === 0) {
  console.log(`No JSON files under ${gdRoot} — nothing to lint`);
  process.exit(2);
}

let errors = 0;
let warnings = 0;

for (const file of files) {
  // Windows では walkDir() が `\` 区切りを返すため、必ず path.relative() + path.sep で
  // OS native の separator を経由して kind 名を取り出す (`/` hard-code は Windows 破綻)
  const relPath = relative(gdRoot, file); // <kind><sep><name>.json
  const expectedKind = relPath.split(sep)[0];
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`✗ ${relPath}: invalid JSON (${e.message})`);
    errors++;
    continue;
  }

  const issues = [];

  // Required field check
  for (const f of REQUIRED_FIELDS) {
    if (!(f in json)) issues.push(`missing required field: ${f}`);
  }

  // kind enum check
  if (json.kind && !VALID_KINDS.has(json.kind)) {
    issues.push(`invalid kind: "${json.kind}" (expected one of ${[...VALID_KINDS].join(" / ")})`);
  }

  // path-kind consistency check
  if (json.kind && json.kind !== expectedKind) {
    issues.push(`path/kind mismatch: file under "${expectedKind}/" but kind="${json.kind}"`);
  }

  // targets enum check (per element)
  if (Array.isArray(json.targets)) {
    for (const t of json.targets) {
      if (!VALID_TARGETS.has(t)) issues.push(`invalid target: "${t}"`);
    }
  } else if ("targets" in json) {
    issues.push("targets must be an array");
  }

  // responsibilities must be array
  if ("responsibilities" in json && !Array.isArray(json.responsibilities)) {
    issues.push("responsibilities must be an array");
  }

  if (issues.length === 0) {
    console.log(`✓ ${relPath}`);
  } else {
    console.log(`✗ ${relPath}:`);
    for (const i of issues) console.log(`    - ${i}`);
    errors++;
  }
}

console.log();
console.log(`Linted: ${files.length}, errors: ${errors}, warnings: ${warnings}`);
process.exit(errors > 0 ? 1 : 0);
