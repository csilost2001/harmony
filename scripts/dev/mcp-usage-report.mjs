#!/usr/bin/env node
/**
 * mcp-usage-report — MCP の tool の呼び出し (サーバのログに 1 行ずつ残る) を集計する。どの tool が失敗しやすいか・遅いか・多い失敗は何かが分かり、
 * tool の説明や資料の改善の優先順位に使える。
 *
 * 使い方: npm run mcp:report [-- --days <日数 (既定 7)>] [--log-dir <ログのフォルダ>] [--json]
 * ログ: logs/harmony-mcp-YYYY-MM-DD.log (JSON Lines。category "mcp" の行 { tool, ok, ms, error? })。引数と結果は残さない。保持は既定 7 日 (DESIGNER_LOG_RETENTION_DAYS)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const normalize = (m) => String(m ?? "").replace(/[「"'`][^」"'`]{1,60}[」"'`]/g, "「…」").replace(/\d+/g, "#").slice(0, 80);
const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };

/** ログの行 (JSON の文字列の並び) を tool ごとに集計する */
export function summarize(lines, { sinceMs = 0 } = {}) {
  const by = new Map();
  let total = 0;
  for (const line of lines) {
    if (!line.includes('"category":"mcp"')) continue; // ログ全体を JSON として読まない (大きいので)
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.category !== "mcp" || e.msg !== "tool" || !e.ctx || typeof e.ctx.tool !== "string") continue;
    if (sinceMs && !(Date.parse(e.ts) >= sinceMs)) continue; // ts が不正な行も除く
    total++;
    const t = by.get(e.ctx.tool) ?? { tool: e.ctx.tool, calls: 0, failures: 0, ms: [], errors: new Map() };
    t.calls++;
    if (typeof e.ctx.ms === "number") t.ms.push(e.ctx.ms);
    if (e.ctx.ok === false) { t.failures++; const k = normalize(e.ctx.error); t.errors.set(k, (t.errors.get(k) ?? 0) + 1); }
    by.set(e.ctx.tool, t);
  }
  const rows = [...by.values()].map((t) => ({
    tool: t.tool.replace(/^designer__/, ""), calls: t.calls, failures: t.failures, failureRate: Math.round((t.failures / t.calls) * 1000) / 10,
    p50: pct(t.ms, 0.5), p95: pct(t.ms, 0.95), topErrors: [...t.errors].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([message, count]) => ({ message, count })),
  })).sort((a, b) => b.failures - a.failures || b.calls - a.calls);
  // 説明や引数が分かりにくい可能性: 5 回以上呼ばれて、失敗が 3 割以上
  const suspects = rows.filter((r) => r.calls >= 5 && r.failureRate >= 30).map((r) => r.tool);
  return { total, rows, suspects };
}

function main() {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const days = Number(val("--days") ?? 7);
  if (!Number.isFinite(days) || days <= 0) { console.error("--days は正の数で指定してください"); process.exit(2); }
  const dir = path.resolve(val("--log-dir") ?? path.join(process.env.DESIGNER_LOG_DIR ?? root, "logs")); // サーバは <DESIGNER_LOG_DIR または本体の根>/logs に書く
  if (!fs.existsSync(dir)) { console.error(`ログのフォルダがありません: ${dir}`); process.exit(2); }
  const files = fs.readdirSync(dir).filter((n) => /^harmony-mcp-.*\.log$/.test(n)).sort();
  const lines = files.flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/));
  const r = summarize(lines, { sinceMs: Date.now() - days * 86400_000 });
  if (args.includes("--json")) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`直近 ${days} 日の MCP の呼び出し ${r.total} 件 (ログ ${files.length} ファイル)`);
  if (!r.total) { console.log("  (記録がありません。サーバを再起動して、AI を使ってから試してください)"); return; }
  console.log(`${"tool".padEnd(32)} ${"回数".padStart(6)} ${"失敗".padStart(5)} ${"失敗率".padStart(7)} ${"p50".padStart(6)} ${"p95".padStart(6)}`);
  for (const t of r.rows.slice(0, 40)) {
    console.log(`${t.tool.padEnd(32)} ${String(t.calls).padStart(6)} ${String(t.failures).padStart(5)} ${(`${t.failureRate}%`).padStart(7)} ${(`${t.p50}ms`).padStart(6)} ${(`${t.p95}ms`).padStart(6)}`);
    for (const e of t.topErrors) console.log(`    ${e.count}× ${e.message}`);
  }
  if (r.suspects.length) console.log(`\n失敗が多い tool (5 回以上で 3 割以上): ${r.suspects.join(", ")} — 説明・引数の説明・資料が分かりにくい可能性。designer__get_tool_guide で見直す`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
