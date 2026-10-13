#!/usr/bin/env node
/**
 * changed-coverage — 単体テストのカバレッジを測り、**この変更 (origin/main との差分) で足した行**が、どれだけテストで通っているかを出す。
 *
 * 全体のカバレッジは、古いコードに引きずられて動かないので、見るのは「新しく足した行」。PR の本文に、この結果を載せる。
 * 使い方:
 *   npm run coverage:changed   差分の行だけ (frontend / backend の単体テストを、カバレッジつきで実行する。数分)
 *   npm run coverage           全体の割合も出す
 *   オプション: --base <ref> (既定 origin/main) / --min <割合> (差分の行が、これを下回ったら失敗。既定は失敗にしない)
 * 結果の詳細: .tmp/coverage/<frontend|backend>/coverage-final.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const base = opt("--base", "origin/main");
const min = opt("--min", null);
const all = args.includes("--all");

const run = (cmd, argv, cwd) => spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const projects = ["frontend", "backend"];
for (const p of projects) {
  const dir = path.join(root, p);
  const out = path.join(root, ".tmp", "coverage", p);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(`${p}: カバレッジつきで単体テストを実行中…`);
  const r = run("npx", ["vitest", "run", "--coverage", "--coverage.provider=v8", `--coverage.reportsDirectory=${out}`, "--coverage.reporter=json", "--coverage.reporter=text-summary", "--coverage.include=src/**/*.{ts,tsx}", "--coverage.exclude=**/*.test.{ts,tsx}", "--reporter=dot"], dir);
  if (r.status !== 0) { console.error(`${r.stdout}${r.stderr}`.split("\n").slice(-30).join("\n")); process.exit(1); }
  if (all) console.log((r.stdout.match(/Coverage summary[\s\S]*?={5,}/) ?? [""])[0]);
}

// 差分で足した行: file -> Set(行番号)
// 作業ツリーと、base との分岐点 (merge-base) の差分 1 本 (commit 済みも未 commit も、同じ行番号 (作業ツリーの行) で数える)
const mergeBase = run("git", ["merge-base", base, "HEAD"], root).stdout.trim() || base;
const diffAll = run("git", ["diff", "--unified=0", mergeBase, "--", "frontend/src", "backend/src"], root);
const added = new Map();
for (const text of [diffAll.stdout]) {
  let file = null;
  for (const line of text.split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) { file = f[1]; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2]);
      const set = added.get(file) ?? new Set();
      for (let i = 0; i < n; i++) set.add(start + i);
      added.set(file, set);
    }
  }
}

let covered = 0, total = 0;
const rows = [];
for (const p of projects) {
  const file = path.join(root, ".tmp", "coverage", p, "coverage-final.json");
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [abs, cov] of Object.entries(data)) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const lines = added.get(rel);
    if (!lines || /\.test\.|\.d\.ts$/.test(rel)) continue;
    // 文 (statement) が始まる行ごとに、通ったか
    const byLine = new Map();
    for (const [id, loc] of Object.entries(cov.statementMap)) {
      const l = loc.start.line;
      byLine.set(l, (byLine.get(l) ?? false) || cov.s[id] > 0);
    }
    let c = 0, t = 0;
    for (const l of lines) if (byLine.has(l)) { t++; if (byLine.get(l)) c++; }
    if (t > 0) { rows.push({ rel, c, t }); covered += c; total += t; }
  }
}
rows.sort((a, b) => (a.c / a.t) - (b.c / b.t));
console.log(`\n足した行のカバレッジ (${base} との差分、実行される文のある行だけ):`);
for (const r of rows) console.log(`  ${String(Math.round((r.c / r.t) * 100)).padStart(3)}%  ${String(r.c).padStart(4)}/${String(r.t).padEnd(4)} ${r.rel}`);
const pct = total ? (covered / total) * 100 : 100;
console.log(`\n合計: ${covered}/${total} 行 (${pct.toFixed(1)}%)`);
if (min !== null && pct < Number(min)) { console.error(`足した行のカバレッジが ${min}% を下回っています`); process.exit(1); }
