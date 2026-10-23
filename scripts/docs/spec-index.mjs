#!/usr/bin/env node
/**
 * 仕様書の索引 (docs/spec/index.json) を、各仕様書の先頭の frontmatter から作る・検査する。
 *
 * frontmatter (docs/spec/*.md の先頭):
 *   ---
 *   description: 1 行の要約 (何についての仕様か)
 *   status: current | deprecated | record      現行の仕様 / 廃止 (記録として残す) / 過去の時点の記録 (評価・監査・ドッグフード)
 *   category: ui | process-flow | schema | design | ops | sample | guide | record   (読む場面の大分け)
 *   ---
 *
 * AI は index.json 1 つで、92 ファイルの中から読むものを選べる (MCP の Resources `harmony://spec/index` も同じ内容)。
 * 使い方: node scripts/docs/spec-index.mjs [--write | --check]   (--check は npm run check:docs に含まれる)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const STATUSES = ["current", "deprecated", "record"];
export const CATEGORIES = ["ui", "process-flow", "schema", "design", "ops", "sample", "guide", "record"];

/** 先頭の frontmatter (--- … ---) を { 項目: 値 } にして、本文とともに返す。無ければ fields は null */
export function parseFrontmatter(text) {
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fields: null, body: text };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      try { v = JSON.parse(v); } catch { v = v.slice(1, -1); }
    }
    fields[kv[1]] = v;
  }
  return { fields, body: text.slice(m[0].length) };
}

/** frontmatter の値を YAML の 1 行 (二重引用符つき) にする */
export const yamlString = (s) => JSON.stringify(s);

export function titleOf(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

/** docs/spec の索引を作る。frontmatter が足りないものは problems に入れる */
export function buildSpecIndex(base = root) {
  const dir = path.join(base, "docs/spec");
  const entries = [];
  const problems = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const file = `docs/spec/${name}`;
    const { fields, body } = parseFrontmatter(fs.readFileSync(path.join(dir, name), "utf8"));
    if (!fields) { problems.push(`${file}: 先頭に frontmatter (description / status / category) がありません`); continue; }
    const miss = ["description", "status", "category"].filter((k) => !fields[k]);
    if (miss.length) problems.push(`${file}: frontmatter に ${miss.join(" / ")} がありません`);
    if (fields.status && !STATUSES.includes(fields.status)) problems.push(`${file}: status は ${STATUSES.join(" / ")} のどれかです (${fields.status})`);
    if (fields.category && !CATEGORIES.includes(fields.category)) problems.push(`${file}: category は ${CATEGORIES.join(" / ")} のどれかです (${fields.category})`);
    entries.push({ file, title: titleOf(body), description: fields.description ?? "", status: fields.status ?? "", category: fields.category ?? "" });
  }
  return { entries, problems };
}

export const renderIndex = (entries) => `${JSON.stringify({ generatedFrom: "docs/spec/*.md の frontmatter (node scripts/docs/spec-index.mjs --write)", specs: entries }, null, 2)}\n`;

/** 索引ファイルが最新か。problems (frontmatter の不足) と stale (index.json のずれ) を返す */
export function checkSpecIndex(base = root) {
  const { entries, problems } = buildSpecIndex(base);
  const target = path.join(base, "docs/spec/index.json");
  const stale = !fs.existsSync(target) || fs.readFileSync(target, "utf8") !== renderIndex(entries);
  return { problems, stale };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const { entries, problems } = buildSpecIndex();
  if (problems.length) { for (const p of problems) console.error(p); process.exit(1); }
  if (arg === "--write") {
    fs.writeFileSync(path.join(root, "docs/spec/index.json"), renderIndex(entries));
    console.log(`docs/spec/index.json に ${entries.length} 件を書きました`);
  } else if (arg === "--check") {
    const { stale } = checkSpecIndex();
    if (stale) { console.error("docs/spec/index.json が古いです: node scripts/docs/spec-index.mjs --write"); process.exit(1); }
    console.log("索引は最新です");
  } else {
    console.log(renderIndex(entries));
  }
}
