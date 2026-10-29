#!/usr/bin/env node
/**
 * no-secrets — git が管理するファイルに、秘密らしい文字列 (API キー・トークン・秘密鍵) が混ざっていないかの検査 (改善提案 第 3 ラウンド #10)。
 * 形が決まっているものだけを見る (誤検出を避けるため)。試験・資料で意図して書く例は、下の ALLOW に置く。
 *
 * 使い方: node scripts/verify/no-secrets.mjs   (見つかれば終了コード 1。npm run check に含まれる)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** [名前, 正規表現] */
export const PATTERNS = [
  ["AWS のアクセスキー", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub のトークン", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["GitHub の細かい権限のトークン", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ["Anthropic の API キー", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["OpenAI の API キー", /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/],
  ["Slack のトークン", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["Google の API キー", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["秘密鍵", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];

/** 意図して書く例のあるファイル (検査の試験・秘密のマスクの試験) */
const ALLOW = [/^scripts\/verify\/no-secrets\.mjs$/, /^scripts\/verify\/test\.mjs$/, /\.test\.(ts|tsx|mjs)$/, /^docs\/html\//];

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|yml|yaml|toml|env|sh|txt|conf)$/;

export function scanText(text) {
  const hits = [];
  for (const [name, re] of PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ name, sample: `${m[0].slice(0, 6)}…(${m[0].length} 文字)` });
  }
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ls = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const files = (ls.stdout ?? "").split("\0").filter((f) => f && TEXT_EXT.test(f) && !ALLOW.some((a) => a.test(f)));
  let bad = 0;
  for (const f of files) {
    let text;
    try { const st = fs.statSync(path.join(root, f)); if (st.size > 5 * 1024 * 1024) continue; text = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
    for (const h of scanText(text)) { console.error(`✗ ${f}: ${h.name} らしい文字列 (${h.sample})`); bad++; }
  }
  if (bad) { console.error(`\n秘密らしい文字列が ${bad} 件あります。本物なら、すぐに無効にして、履歴からも消してください。例なら、形を変えるか、scripts/verify/no-secrets.mjs の ALLOW へ`); process.exit(1); }
  console.log(`秘密らしい文字列: なし (${files.length} ファイルを検査)`);
}
