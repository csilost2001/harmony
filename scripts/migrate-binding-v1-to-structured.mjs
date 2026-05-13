#!/usr/bin/env node
/**
 * scripts/migrate-binding-v1-to-structured.mjs
 *
 * description フィールドの `[binding.v1] ` sentinel 形式から
 * ScreenItem.binding (structured) への migration script。
 *
 * 使用方法:
 *   node scripts/migrate-binding-v1-to-structured.mjs              # dry-run (変更一覧のみ表示)
 *   node scripts/migrate-binding-v1-to-structured.mjs --apply      # 実書き込み
 *   node scripts/migrate-binding-v1-to-structured.mjs --project examples/retail  # プロジェクト限定
 *   node scripts/migrate-binding-v1-to-structured.mjs --project examples/retail --apply
 *
 * 冪等性:
 *   - 既に `binding` field がある ScreenItem はスキップ
 *   - sentinel のない description は無変更
 *   - 2 回目以降の実行は何もしないで終わる (冪等)
 *
 * sentinel 形式 (legacy):
 *   description: "[binding.v1] binding.attr=th:field; binding.path=form.productCode; source=spec.md#sec"
 *
 * 移行後の structured 形式 (#1065):
 *   binding: { kind: "formField", path: "form.productCode", sourceNote: "spec.md#sec" }
 *
 * binding.attr → kind マッピング:
 *   th:field, th:value → formField
 *   th:text            → viewModel
 *   th:each            → catalog
 *   その他             → item.direction から推定 (input→formField / output/viewer→viewModel / 未定義→formField)
 *
 * 詳細設計: docs/spec/generic-definition-layer.md §3.1 / ISSUE #1065
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const APPLY = process.argv.includes("--apply");
const projectArgIdx = process.argv.indexOf("--project");
const projectArg = projectArgIdx !== -1 ? process.argv[projectArgIdx + 1] : null;

// sentinel prefix (先頭 13 文字)
const SENTINEL = "[binding.v1] ";
const SENTINEL_LEN = SENTINEL.length;

// binding.attr → kind mapping
const ATTR_TO_KIND = {
  "th:field": "formField",
  "th:value": "formField",
  "th:text": "viewModel",
  "th:each": "catalog",
};

// direction → default kind fallback
const DIRECTION_TO_KIND = {
  input: "formField",
  output: "viewModel",
  viewer: "viewModel",
};

// 有効な role 値
const VALID_ROLES = new Set(["display", "input", "both"]);

// 統計
let scannedFiles = 0;
let migratedItems = 0;
let skippedItems = 0;
let errorItems = 0;

// ── ユーティリティ ────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (e) {
    return null;
  }
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** readdirSync で再帰的にファイルを列挙 */
function walk(dir, ext = ".json") {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * sentinel 文字列を key=value ペアにパース。
 * 入力例: "binding.attr=th:field; binding.path=form.productCode; source=spec.md#sec"
 * 出力例: { "binding.attr": "th:field", "binding.path": "form.productCode", "source": "spec.md#sec" }
 */
function parseSentinelBody(body) {
  const pairs = {};
  const unknownParts = [];
  const parts = body.split(";").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) {
      unknownParts.push(part);
      continue;
    }
    const key = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    pairs[key] = value;
  }
  return { pairs, unknownParts };
}

/**
 * 1 件の ScreenItem を migration。
 * 戻り値: { changed: boolean, item: object, warnings: string[] }
 */
function migrateItem(item, fileLabel) {
  const warnings = [];

  // sentinel なし → skip
  if (typeof item.description !== "string" || !item.description.startsWith(SENTINEL)) {
    return { changed: false, item, warnings };
  }

  // 既に binding field あり → skip (冪等)
  if (item.binding !== undefined) {
    return { changed: false, item, warnings };
  }

  const body = item.description.slice(SENTINEL_LEN);
  const { pairs, unknownParts } = parseSentinelBody(body);

  if (unknownParts.length > 0) {
    warnings.push(`unknown parts (kept in description): ${unknownParts.join("; ")}`);
  }

  // 未知 key の検出
  const knownKeys = new Set(["binding.attr", "binding.path", "binding.role", "binding.formatHint", "source"]);
  const unknownKeys = Object.keys(pairs).filter((k) => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    warnings.push(`unknown keys (kept in description): ${unknownKeys.join(", ")}`);
  }

  // binding.attr から kind を決定
  const attrValue = pairs["binding.attr"];
  let kind;
  if (attrValue !== undefined) {
    kind = ATTR_TO_KIND[attrValue];
    if (kind === undefined) {
      // 未知 attr → direction から推定
      kind = DIRECTION_TO_KIND[item.direction] ?? "formField";
      warnings.push(`unknown binding.attr="${attrValue}", kind inferred from direction as "${kind}"`);
    }
  } else {
    // binding.attr なし → direction から推定
    kind = DIRECTION_TO_KIND[item.direction] ?? "formField";
  }

  // binding object を構築
  const binding = { kind };

  if (pairs["binding.path"] !== undefined) {
    binding.path = pairs["binding.path"];
  }

  if (pairs["binding.role"] !== undefined) {
    const role = pairs["binding.role"];
    if (VALID_ROLES.has(role)) {
      binding.role = role;
    } else {
      warnings.push(`invalid binding.role="${role}" (allowed: display/input/both) — skipped`);
    }
  }

  if (pairs["binding.formatHint"] !== undefined) {
    binding.formatHint = pairs["binding.formatHint"];
  }

  // sourceNote: source field + originalAttr の結合
  const sourceNoteParts = [];
  if (pairs["source"] !== undefined) {
    sourceNoteParts.push(pairs["source"]);
  }
  if (attrValue !== undefined) {
    sourceNoteParts.push(`originalAttr=${attrValue}`);
  }
  if (sourceNoteParts.length > 0) {
    binding.sourceNote = sourceNoteParts.join("; ");
  }

  // description: sentinel + 既知 key を除去した後の自由文
  // 残す部分: unknownParts + unknownKeys の値
  const remainParts = [];
  if (unknownParts.length > 0) remainParts.push(...unknownParts);
  for (const k of unknownKeys) {
    remainParts.push(`${k}=${pairs[k]}`);
  }

  const newItem = { ...item };
  newItem.binding = binding;

  if (remainParts.length > 0) {
    newItem.description = remainParts.join("; ");
  } else {
    delete newItem.description;
  }

  return { changed: true, item: newItem, warnings };
}

/**
 * screen JSON ファイル (items[] を持つ) を migration。
 * 戻り値: { changed: boolean, data: object, changes: string[] }
 */
function migrateScreenFile(filePath) {
  const data = readJson(filePath);
  if (!data) {
    errorItems++;
    return { changed: false, data: null, changes: [`ERROR: failed to read ${filePath}`] };
  }

  // items[] を探す (flat またはネスト)
  const items = Array.isArray(data.items) ? data.items : null;
  if (!items) {
    // items なし → skip (design ファイル等)
    return { changed: false, data, changes: [] };
  }

  let fileChanged = false;
  const changes = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;

    const { changed, item: newItem, warnings } = migrateItem(item, filePath);
    if (changed) {
      items[i] = newItem;
      fileChanged = true;
      migratedItems++;
      const label = `[${i}] id=${item.id ?? "?"}`;
      changes.push(`  MIGRATE ${label}: binding.kind=${newItem.binding.kind}`);
      if (warnings.length > 0) {
        changes.push(...warnings.map((w) => `    WARN: ${w}`));
      }
    } else {
      // description なし、または既に binding あり → skipped
      if (item.description !== undefined && item.description.startsWith(SENTINEL) && item.binding !== undefined) {
        skippedItems++;
      }
    }
  }

  return { changed: fileChanged, data, changes };
}

/**
 * harmony.json の dataDir を解決して screens ディレクトリを返す。
 */
function screensDir(projectRoot) {
  const harmonyPath = join(projectRoot, "harmony.json");
  if (!existsSync(harmonyPath)) return null;
  const harmony = readJson(harmonyPath);
  const dataDir = harmony?.dataDir ?? "harmony";
  return join(projectRoot, dataDir, "screens");
}

/**
 * プロジェクトルートから screen JSON ファイルを列挙する。
 * - <dataDir>/screens/*.json (flat)
 * - <dataDir>/screens/<uuid>/*.json (per-screen dir)
 */
function collectScreenFiles(projectRoot) {
  const sd = screensDir(projectRoot);
  if (!sd || !existsSync(sd)) return [];
  return walk(sd);
}

/**
 * 走査対象プロジェクトを列挙する。
 */
function collectProjects() {
  if (projectArg) {
    const abs = resolve(ROOT, projectArg);
    return [abs];
  }
  const projects = [];
  // examples/ 配下
  const examplesDir = join(ROOT, "examples");
  if (existsSync(examplesDir)) {
    for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const p = join(examplesDir, entry.name);
        if (existsSync(join(p, "harmony.json"))) projects.push(p);
      }
    }
  }
  // workspaces/ 配下
  const workspacesDir = join(ROOT, "workspaces");
  if (existsSync(workspacesDir)) {
    for (const entry of readdirSync(workspacesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const p = join(workspacesDir, entry.name);
        if (existsSync(join(p, "harmony.json"))) projects.push(p);
      }
    }
  }
  return projects;
}

// ── メイン ───────────────────────────────────────────────────────────────

const mode = APPLY ? "apply" : "dry-run";
console.log(`[migrate-binding-v1] mode=${mode}`);
if (projectArg) {
  console.log(`[migrate-binding-v1] project=${projectArg}`);
}

const projects = collectProjects();
if (projects.length === 0) {
  console.log("[migrate-binding-v1] no projects found");
} else {
  console.log(`[migrate-binding-v1] scanning ${projects.length} project(s)...`);
}

for (const projectRoot of projects) {
  const files = collectScreenFiles(projectRoot);
  for (const filePath of files) {
    scannedFiles++;
    const { changed, data, changes } = migrateScreenFile(filePath);

    if (changes.length > 0) {
      const relPath = filePath.replace(ROOT + "/", "");
      console.log(`\n${relPath}:`);
      for (const c of changes) {
        console.log(c);
      }
    }

    if (changed && APPLY) {
      writeJson(filePath, data);
    }
  }
}

console.log();
console.log(`Scanned: ${scannedFiles} files, Migrated: ${migratedItems} items, Skipped: ${skippedItems} items, Errors: ${errorItems} items`);

process.exit(errorItems > 0 ? 1 : 0);
