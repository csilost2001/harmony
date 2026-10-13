#!/usr/bin/env node
/**
 * bundle-budget — フロントエンドの本番ビルドの大きさの予算を検査する。
 *
 * 画面ごとの遅延読み込み (frontend/src/routing/lazyViews.ts) で、最初に読み込む JS (入口) を小さく保つ。
 * 画面の import を、静的な import で足し直すと、入口が膨らむ (以前は 1 本で約 4.9 MB) ので、ここで止める。
 *
 * 予算 (実測 + 余裕):
 *   入口 (index-*.js)       850 kB 以下  (実測 約 740 kB)
 *   入口以外の 1 チャンク    400 kB 以下  (実測の最大 約 285 kB。処理フローの編集)
 * 予算を超えたら、まず「なぜ増えたか」(静的 import で、画面や重いライブラリが入口に入っていないか) を確かめる。
 * 画面が正当に大きくなったときだけ、この数値を上げる (理由を PR に書く)。
 *
 * 使い方: node scripts/verify/bundle-budget.mjs   (frontend を vite build して、.tmp/bundle-check に出す)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, ".tmp", "bundle-check");
const ENTRY_MAX_KB = 850;
const CHUNK_MAX_KB = 400;

fs.rmSync(out, { recursive: true, force: true });
const r = spawnSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir"], { cwd: path.join(root, "frontend"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) { console.error(`${r.stdout}${r.stderr}`.split("\n").slice(-30).join("\n")); process.exit(1); }

const assets = path.join(out, "assets");
const files = fs.readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => ({ f, kb: fs.statSync(path.join(assets, f)).size / 1024 }));
const entry = files.filter((x) => /^index-/.test(x.f)).sort((a, b) => b.kb - a.kb)[0];
const others = files.filter((x) => x !== entry).sort((a, b) => b.kb - a.kb);
const total = files.reduce((s, x) => s + x.kb, 0);
const problems = [];
if (!entry) problems.push("入口 (index-*.js) が見つかりません");
else if (entry.kb > ENTRY_MAX_KB) problems.push(`入口 ${entry.f} が ${entry.kb.toFixed(0)} kB (予算 ${ENTRY_MAX_KB} kB)。画面や重いライブラリを静的に import していないか確かめてください (画面は routing/lazyViews.ts 経由)`);
for (const o of others) if (o.kb > CHUNK_MAX_KB) problems.push(`チャンク ${o.f} が ${o.kb.toFixed(0)} kB (予算 ${CHUNK_MAX_KB} kB)`);
console.log(`入口 ${entry?.kb.toFixed(0)} kB / 最大のチャンク ${others[0]?.f} ${others[0]?.kb.toFixed(0)} kB / 全体 ${total.toFixed(0)} kB (${files.length} 個)`);
if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
