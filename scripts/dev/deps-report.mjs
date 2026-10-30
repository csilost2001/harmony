#!/usr/bin/env node
/**
 * deps-report — 依存の健全性の点検 (改善提案 第 3 ラウンド #4〜9)。ネットワークを使う項目があるので、npm run check には含めない。リリース前・定期に回す。
 *
 *   audit     既知の脆弱性 (npm audit)。high 以上が 1 件でもあれば失敗 (予算 0)。moderate 以下は知らせ
 *   license   本番の依存のライセンス。許可リストにないもの (GPL / AGPL / LGPL / 不明) があれば失敗
 *   lock      package.json とロックファイルの食い違い (npm ls の problems)
 *   unused    どのソースからも import されていない依存 (知らせ。設定・ツールとして使うものは除く)
 *   outdated  古い依存の一覧 (知らせ)
 *   engines   動かしている Node と npm が、package.json の engines を満たすか
 *   runtime   Node と npm が最新か (ネットワーク)。nodejs.org の一覧と npm view npm version を見て、
 *             新しい LTS のメジャーが出ている・同じメジャーの最新パッチより古い (出てから 14 日までは知らせ)・npm が最新より古い・.nvmrc と違う、を指摘する (#1571)。
 *             取れなければ「読めません (ネットワーク)」と知らせるだけで、失敗にしない
 *
 * 使い方: npm run check:deps [-- audit license lock unused outdated engines runtime] [--json]   (指定なしは全部。失敗は終了コード 1)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enginesCheck, runtimeFindings, versionAtLeast } from "../lib/setup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const wanted = new Set(args.filter((a) => !a.startsWith("--")));
const all = (name) => wanted.size === 0 || wanted.has(name);

/** 本番の依存で許すライセンス (SPDX)。弱いコピーレフト (MPL) までは許す */
export const ALLOWED_LICENSES = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Unlicense", "CC0-1.0", "BlueOak-1.0.0", "Python-2.0", "CC-BY-4.0", "MPL-2.0", "Zlib", "WTFPL"]);
/** import されなくても使う依存 (型・設定・ツール) */
const TOOL_DEPS = /^(@types\/|typescript$|eslint|@eslint\/|typescript-eslint$|vite$|@vitejs\/|vitest$|@vitest\/|@playwright\/|playwright|tsx$|globals$|jsdom$|@testing-library\/|bootstrap-icons$|concurrently$)/;

const run = (cmd, a, opt = {}) => spawnSync(cmd, a, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opt });
const report = [];
const add = (name, ok, lines) => report.push({ name, ok, lines });

/** いま動いている npm の版 (読めなければ null) */
function npmVersionNow() {
  const r = run("npm", ["-v"], { shell: process.platform === "win32" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** nodejs.org の一覧から、最新の LTS の版 ("v26.13.0 (Lithium)") */
export function latestLts(releases) {
  const lts = releases.filter((r) => r.lts);
  if (lts.length === 0) return "(見つかりません)";
  const l = lts.reduce((hi, r) => (versionAtLeast(hi.version, r.version) ? hi : r));
  return `${l.version} (${l.lts})`;
}

/** license の文字を SPDX の部品に割る ("(MIT OR Apache-2.0)" など。OR は、どれか 1 つが許可なら可) */
export function licenseOk(license) {
  if (!license || typeof license !== "string") return false;
  const parts = license.replace(/[()]/g, "").split(/\s+OR\s+/i).map((s) => s.trim());
  return parts.some((p) => p.split(/\s+AND\s+/i).every((x) => ALLOWED_LICENSES.has(x.trim())));
}

async function main() {
  if (all("audit")) {
    const r = run("npm", ["audit", "--json"]);
    try {
      const v = JSON.parse(r.stdout).metadata.vulnerabilities;
      const bad = v.high + v.critical;
      add("audit", bad === 0, [`脆弱性: critical ${v.critical} / high ${v.high} / moderate ${v.moderate} / low ${v.low} (high 以上は 0 件が予算)`]);
    } catch { add("audit", false, ["npm audit の結果が読めません (ネットワークは使えますか)"]); }
  }

  if (all("license")) {
    const r = run("npm", ["ls", "--omit=dev", "--all", "--json", "--long"]);
    const seen = new Map();
    try {
      const walk = (deps) => { for (const [name, d] of Object.entries(deps ?? {})) { if (d.path || d.version) seen.set(`${name}@${d.version}`, d.license ?? d._license ?? readLicense(d.path)); walk(d.dependencies); } };
      walk(JSON.parse(r.stdout).dependencies);
    } catch { /* 下で報告 */ }
    function readLicense(p) {
      try { const pj = JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8")); return typeof pj.license === "string" ? pj.license : pj.license?.type ?? (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(" OR ") : undefined); } catch { return undefined; }
    }
    const bad = [...seen].filter(([k, l]) => !k.startsWith("harmony") && !k.startsWith("backend@") && !k.startsWith("frontend@") && !k.startsWith("@harmony/") && !licenseOk(l));
    const counts = new Map();
    for (const l of seen.values()) counts.set(l ?? "(不明)", (counts.get(l ?? "(不明)") ?? 0) + 1);
    add("license", seen.size > 0 && bad.length === 0, [`本番の依存 ${seen.size} 件: ${[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(" / ")}`, ...bad.map(([k, l]) => `許可リストにない: ${k} (${l ?? "不明"})`)]);
  }

  if (all("lock")) {
    const r = run("npm", ["ls", "--all", "--json"]);
    let problems = [];
    try { problems = JSON.parse(r.stdout).problems ?? []; } catch { problems = ["npm ls の結果が読めません"]; }
    add("lock", problems.length === 0, problems.length ? problems.slice(0, 8) : ["package.json とロックファイルは合っています"]);
  }

  if (all("unused")) {
    const lines = [];
    for (const ws of ["frontend", "backend", "shared"]) {
      const pjPath = path.join(root, ws, "package.json");
      if (!fs.existsSync(pjPath)) continue;
      const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
      const files = run("git", ["ls-files", ws]).stdout.split("\n").filter((f) => /\.(ts|tsx|js|mjs|mts|css)$/.test(f));
      const text = files.map((f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return ""; } }).join("\n");
      for (const dep of Object.keys(pj.dependencies ?? {})) {
        if (TOOL_DEPS.test(dep)) continue;
        if (!text.includes(`"${dep}"`) && !text.includes(`'${dep}'`) && !text.includes(`"${dep}/`) && !text.includes(`'${dep}/`)) lines.push(`${ws}: ${dep} (どのソースからも import されていません)`);
      }
    }
    add("unused", true, lines.length ? lines : ["使われていない依存は見つかりませんでした"]);
  }

  if (all("outdated")) {
    const r = run("npm", ["outdated", "--json", "--all"]);
    try {
      const o = JSON.parse(r.stdout || "{}");
      const major = Object.entries(o).filter(([, v]) => v.current && v.latest && v.current.split(".")[0] !== v.latest.split(".")[0]);
      add("outdated", true, [`古い依存 ${Object.keys(o).length} 件 (うち、メジャーの版が違うもの ${major.length} 件)`, ...major.slice(0, 15).map(([k, v]) => `  ${k}: ${v.current} → ${v.latest}`)]);
    } catch { add("outdated", true, ["npm outdated の結果が読めません (ネットワーク)"]); }
  }

  if (all("engines")) {
    const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const r = enginesCheck({ nodeVersion: process.version, npmVersion: npmVersionNow(), pkg: pj });
    add("engines", r.ok, r.lines);
  }

  if (all("runtime")) {
    const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const nvmrcPath = path.join(root, ".nvmrc");
    const nvmrc = fs.existsSync(nvmrcPath) ? fs.readFileSync(nvmrcPath, "utf8") : undefined;
    const npmVersion = npmVersionNow();
    let releases;
    try {
      const res = await fetch("https://nodejs.org/dist/index.json", { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(String(res.status));
      releases = await res.json();
    } catch { releases = undefined; }
    const v = run("npm", ["view", "npm", "version"], { timeout: 30000, shell: process.platform === "win32" });
    const latestNpm = v.status === 0 && /^\d+\.\d+\.\d+/.test(v.stdout.trim()) ? v.stdout.trim() : undefined;
    const f = runtimeFindings({ nodeVersion: process.version, npmVersion, nvmrc, pkg: pj, releases, latestNpm, nvmrcAsProblem: true });
    add("runtime", f.problems.length === 0, [
      `動かしている Node = ${process.version}、npm = ${npmVersion ?? "(読めません)"}、.nvmrc = ${nvmrc?.trim() ?? "(なし)"}`,
      releases ? `Node の最新の LTS: ${latestLts(releases)}` : "Node の最新の版を読めません (ネットワーク)。LTS とパッチの比較は飛ばしました",
      latestNpm ? `npm の最新: ${latestNpm}` : "npm の最新の版を読めません (ネットワーク)。比較は飛ばしました",
      ...f.problems,
      ...f.notices.map((n) => `知らせ: ${n}`),
    ]);
  }

  if (json) console.log(JSON.stringify(report, null, 2));
  else for (const r of report) { console.log(`${r.ok ? "✓" : "✗"} ${r.name}`); for (const l of r.lines) console.log(`    ${l}`); }
  process.exit(report.every((r) => r.ok) ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
