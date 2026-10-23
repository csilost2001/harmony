#!/usr/bin/env node
/**
 * docs-freshness — 利用者向け資料と、画面・コマンド・スキルの乖離の検査 (オフライン。ファイルを読むだけ)。
 *
 * 失敗にするもの (資料が、実物と食い違っている):
 *   1. 資料 (AGENTS.md / CLAUDE.md / README.md / docs/ の仕様・規約・ユーザーガイド) の、相対リンクの先がない
 *   2. 資料の `npm run <名前>` が、どの package.json にもない
 *   3. AGENTS.md の「Routing」の表と、画面の経路 (AppShell.tsx の <Route>) が合わない (表にない経路 / 画面にない経路)
 *   4. UI 操作リファレンス (docs/user-guide/ui-reference) の「対象画面」のファイルがない・「ルート」の経路がない・スクリーンショットがない
 *   5. CLAUDE.md のスキル表のスキルが ai-skills/ にない
 *   6. 仕様書 (docs/spec/*.md) の先頭の frontmatter (description / status / category) の不足、索引 docs/spec/index.json のずれ (直し方: node scripts/docs/spec-index.mjs --write)
 *   7. AI 向けの資料 (docs/AI-INDEX.md・docs/spec/ai-recipes.md・docs/spec/mcp-design-access.md) の `tool_name` が、MCP の tool にない
 *   8. 正本から自動で作る資料 (スキーマの索引・工程の種類・self-check ルール・用語集・サンプルのパターン) が、正本とずれている (直し方: node scripts/docs/generated.mjs --write)
 *   9. 資料の中の、印 (`<!-- schema: … -->`) つきの JSON の例が、スキーマに合わない (scripts/docs/json-examples.mjs)
 *  10. docs/codemap.md と、主要ディレクトリの README に書いた `パス` が、実在しない
 * 知らせるだけのもの (--info で表示。--strict で失敗):
 *   - UI 操作リファレンスのない画面 / 仕様書の索引 (docs/spec/README.md) にない仕様書 / ai-skills/ にあるが CLAUDE.md の表にないスキル
 *   - スクリーンショットが、画面のコードの最後の変更より古いもの (git の履歴で比べる)
 * 使い方: npm run check:docs [-- --info] [-- --strict]   (check に含まれる。スクリーンショットの更新は: npm run docs:shots)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkSpecIndex } from "../docs/spec-index.mjs";
import { checkGenerated } from "../docs/generated.mjs";
import { checkJsonExamples } from "../docs/json-examples.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 過去の時点の記録 (計画・ドッグフードの記録・プレゼン・試作・生成物)。リンクが古くても、検査しない */
const SKIP_DIRS = ["node_modules", ".git", ".tmp", "dist", "html", "plans", "presentation", "prototypes"];
const SKIP_FILE = /^(dogfood-|_audit|phase\d-evaluation|mcp-server-step1-plan|schema-audit)/;

export function listDocs(base) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.includes(e.name)) walk(p); }
      else if (e.name.endsWith(".md") && !SKIP_FILE.test(e.name)) out.push(p);
    }
  };
  walk(path.join(base, "docs"));
  for (const f of ["AGENTS.md", "CLAUDE.md", "README.md", "backend/AGENTS.md", "frontend/AGENTS.md"]) if (fs.existsSync(path.join(base, f))) out.push(path.join(base, f));
  return out;
}

/** コードブロックと、行の中のコード (`…`) を除く (リンクや npm run の例を、誤って拾わない) */
export const stripCode = (md) => md.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
const stripInline = (md) => stripCode(md).replace(/`[^`\n]*`/g, "");

/** 1. 相対リンクの先がないもの */
export function brokenLinks(files, base) {
  const out = [];
  for (const f of files) {
    const text = stripInline(fs.readFileSync(f, "utf8"));
    for (const m of text.matchAll(/\]\((?!https?:|mailto:|#|<)([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0].split("?")[0];
      if (!target) continue;
      let decoded = target;
      try { decoded = decodeURIComponent(target); } catch { /* そのまま */ }
      const abs = decoded.startsWith("/") ? path.join(base, decoded) : path.resolve(path.dirname(f), decoded);
      if (!fs.existsSync(abs)) out.push({ file: path.relative(base, f), link: m[1] });
    }
  }
  return out;
}

/** 2. package.json の scripts の名前 (ルートと、各ワークスペース) */
export function npmScriptNames(base) {
  const names = new Set();
  for (const p of ["package.json", "frontend/package.json", "backend/package.json", "shared/package.json", "docs-site/package.json"]) {
    try { for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(base, p), "utf8")).scripts ?? {})) names.add(k); } catch { /* 無ければ飛ばす */ }
  }
  return names;
}
export function unknownNpmScripts(files, base) {
  const known = npmScriptNames(base);
  const out = [];
  for (const f of files) {
    const text = stripCode(fs.readFileSync(f, "utf8"));
    // コードブロックの中にも、よく書く (`npm run check` など)。行の中のコードと、コードブロックの両方を見る
    const all = fs.readFileSync(f, "utf8");
    for (const m of all.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) if (!known.has(m[1])) out.push({ file: path.relative(base, f), script: m[1] });
    void text;
  }
  return out;
}

/** 3. 画面の経路 (AppShell.tsx の <Route path>)。ワークスペース配下は `/w/:wsId` を除いた形、top-level はそのまま。パラメータ名は `:x` にそろえる */
export const normRoute = (r) => (r.replace(/\/w\/:wsId\/?/, "/").replace(/:[A-Za-z]+/g, ":x").replace(/(.)\/+$/, "$1") || "/");
export function appRoutes(appShellSource) {
  const routes = new Set();
  for (const m of appShellSource.matchAll(/<Route path="([^"]+)"/g)) {
    const p = m[1];
    if (p === "*" || p.startsWith("/w/:wsId") && p.length <= "/w/:wsId".length + 2) continue;
    if (p.startsWith("/")) routes.add(normRoute(p));
    else routes.add(normRoute(`/${p}`));
  }
  return routes;
}

/** 別の経路へ飛ばすだけの旧 URL (リダイレクト用)。Routing の表には載せない */
export const REDIRECT_ROUTES = new Set(["/page-layout/design/:x"]);

/** AGENTS.md の Routing の表の、経路の書き方 (`/a/b` / `/a/*` / `/a[/:k[/:n]]`) を、検査できる形にする */
export function docRoutes(agentsMd) {
  const section = agentsMd.split(/^### Routing/m)[1]?.split(/^###? /m)[0] ?? "";
  const exact = new Set();
  const prefixes = [];
  for (const row of section.split("\n")) {
    if (!row.startsWith("|") || /^\|[-| ]+\|$/.test(row)) continue;
    const first = row.split("|")[1] ?? "";
    for (const m of first.matchAll(/`([^`]+)`/g)) {
      let p = m[1].trim();
      if (!p.startsWith("/")) continue;
      if (p.endsWith("/*")) { prefixes.push(normRoute(p.slice(0, -2))); continue; }
      const opt = /^(.*?)\[\/(:\w+)(?:\[\/(:\w+)\])?\]$/.exec(p);
      if (opt) { exact.add(normRoute(opt[1])); exact.add(normRoute(`${opt[1]}/${opt[2]}`)); if (opt[3]) exact.add(normRoute(`${opt[1]}/${opt[2]}/${opt[3]}`)); continue; }
      exact.add(normRoute(p));
    }
  }
  return { exact, prefixes };
}
export function routeCovered(route, doc) {
  return doc.exact.has(route) || doc.prefixes.some((p) => route === p || route.startsWith(`${p}/`));
}
export function routeTableDrift(appShellSource, agentsMd) {
  const app = appRoutes(appShellSource);
  const doc = docRoutes(agentsMd);
  const missingInDocs = [...app].filter((r) => r !== "/" && !REDIRECT_ROUTES.has(r) && !routeCovered(r, doc)).sort();
  const missingInApp = [...doc.exact].filter((r) => r !== "/" && !app.has(r)).sort();
  return { missingInDocs, missingInApp };
}

/** 4. UI 操作リファレンス */
export function uiReferenceIssues(base, routes) {
  const dir = path.join(base, "docs/user-guide/ui-reference");
  const errors = [], infos = [];
  if (!fs.existsSync(dir)) return { errors, infos, covered: new Set(), docs: [] };
  const covered = new Set();
  const docs = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md" && n !== "common-operations.md")) {
    const f = path.join(dir, name);
    const text = fs.readFileSync(f, "utf8");
    const head = text.split("\n").slice(0, 12).join("\n");
    const rel = `docs/user-guide/ui-reference/${name}`;
    const comp = /対象画面\*\*:\s*`[^`]*`\s*\(`([^`]+)`\)/.exec(head)?.[1];
    if (comp && !fs.existsSync(path.join(base, comp))) errors.push({ file: rel, message: `対象画面のファイルがありません: ${comp}` });
    for (const line of head.split("\n").filter((l) => /\*\*(対象)?ルート\*\*/.test(l))) {
      for (const m of line.matchAll(/`(\/[^`]*)`/g)) {
        const r = normRoute(m[1].replace(/\s*\(.*$/, ""));
        covered.add(r);
        if (!routes.has(r) && r !== "/") errors.push({ file: rel, message: `ルートが、画面にありません: ${m[1]}` });
      }
    }
    for (const m of stripCode(text).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(m[1])) continue;
      if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) errors.push({ file: rel, message: `スクリーンショットがありません: ${m[1]}` });
    }
    docs.push({ name, rel, comp, shots: [...stripCode(text).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => path.resolve(path.dirname(f), m[1])) });
  }
  for (const r of routes) if (r !== "/" && !REDIRECT_ROUTES.has(r) && !covered.has(r)) infos.push({ message: `UI 操作リファレンスのない画面: ${r}` });
  return { errors, infos, covered, docs };
}

/** スクリーンショットが、画面のコードの最後の変更より古いもの (git の履歴。git が使えなければ空) */
export function staleShots(docs, base) {
  const commitTime = (p) => {
    const r = spawnSync("git", ["log", "-1", "--format=%ct", "--", p], { cwd: base, encoding: "utf8" });
    return r.status === 0 && r.stdout.trim() ? Number(r.stdout.trim()) : null;
  };
  const out = [];
  for (const d of docs) {
    if (!d.comp || !d.shots.length) continue;
    const codeTime = commitTime(d.comp.replace(/\/[^/]*\.tsx$/, "/")) ?? commitTime(d.comp);
    if (codeTime === null) continue;
    const shotTimes = d.shots.map((s) => commitTime(path.relative(base, s))).filter((t) => t !== null);
    if (!shotTimes.length) continue;
    const newest = Math.max(...shotTimes);
    if (newest < codeTime) out.push({ file: d.rel, message: `スクリーンショットが、画面のコードより古い (${new Date(newest * 1000).toISOString().slice(0, 10)} < ${new Date(codeTime * 1000).toISOString().slice(0, 10)})` });
  }
  return out;
}

/** 5. スキル */
export function skillIssues(claudeMd, base) {
  const errors = [], infos = [];
  const section = claudeMd.split(/^### Skills/m)[1]?.split(/^###? /m)[0] ?? "";
  const listed = new Set();
  for (const row of section.split("\n")) {
    if (!row.startsWith("|") || /^\|[-| ]+\|$/.test(row)) continue;
    const first = row.split("|")[1] ?? "";
    for (const m of first.matchAll(/`\/([a-z][a-z0-9-]*)(?:[ `])/g)) listed.add(m[1]);
  }
  for (const s of listed) if (!fs.existsSync(path.join(base, "ai-skills", s, "SKILL.md"))) errors.push({ file: "CLAUDE.md", message: `スキル /${s} が、ai-skills/ にありません` });
  const dir = path.join(base, "ai-skills");
  if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md")) && !listed.has(e.name)) infos.push({ message: `ai-skills/${e.name} が、CLAUDE.md のスキル表にありません` });
  return { errors, infos };
}

/** 仕様書の索引にない仕様書 */
export function specIndexGaps(base) {
  const dir = path.join(base, "docs/spec");
  const idx = path.join(dir, "README.md");
  if (!fs.existsSync(idx)) return [];
  const text = fs.readFileSync(idx, "utf8");
  return fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md" && !SKIP_FILE.test(n) && !text.includes(n)).map((n) => ({ message: `docs/spec/${n} が、仕様書の索引 (docs/spec/README.md) にありません` }));
}

/** 6. 仕様書の frontmatter の不足と、索引のずれ */
export function specFrontmatterIssues(base) {
  if (!fs.existsSync(path.join(base, "docs/spec"))) return [];
  const { problems, stale } = checkSpecIndex(base);
  const out = problems.map((message) => ({ file: message.split(":")[0], message: message.slice(message.indexOf(":") + 2) }));
  if (!out.length && stale) out.push({ file: "docs/spec/index.json", message: "仕様書の frontmatter と合っていません。node scripts/docs/spec-index.mjs --write で作り直してください" });
  return out;
}

/** 7. AI 向けの資料にある tool の名前 (`snake_case` / `designer__x`) が、MCP の tool にあるか */
const TOOL_NAME_DOCS = ["docs/AI-INDEX.md", "docs/spec/ai-recipes.md", "docs/spec/mcp-design-access.md"];
export function aiIndexToolIssues(base) {
  const toolsTs = path.join(base, "backend/src/tools.ts");
  if (!fs.existsSync(toolsTs)) return [];
  const known = new Set([...fs.readFileSync(toolsTs, "utf8").matchAll(/name:\s*"(?:designer|editSession)__([a-z_]+)"/g)].map((m) => m[1]));
  const out = [];
  for (const rel of TOOL_NAME_DOCS) {
    const doc = path.join(base, rel);
    if (!fs.existsSync(doc)) continue;
    // `designer__x` / `editSession__x` は接頭辞つきで、`x_y` は接頭辞なしで書く (1 語の `check` などは tool の名前とみなさない)
    for (const m of fs.readFileSync(doc, "utf8").matchAll(/`(?:(?:designer|editSession)__([a-z]+(?:_[a-z]+)*)|([a-z]+(?:_[a-z]+)+))`/g)) {
      const name = m[1] ?? m[2];
      if (!known.has(name)) out.push({ file: rel, message: `MCP の tool にない名前です: ${name}` });
    }
  }
  return [...new Map(out.map((o) => [`${o.file}|${o.message}`, o])).values()];
}

/** 8. 正本から作る資料のずれ */
export function generatedIssues(base) {
  if (!fs.existsSync(path.join(base, "schemas/v3")) || !fs.existsSync(path.join(base, "ai-skills/create-flow/SKILL.md"))) return [];
  return checkGenerated(base);
}

/** 9. 印つきの JSON の例のずれ */
export function jsonExampleIssues(base) {
  if (!fs.existsSync(path.join(base, "schemas/v3"))) return [];
  return checkJsonExamples(base).problems.map((p) => ({ file: p.split(":")[0], message: p.slice(p.indexOf(":") + 1).replace(/^\d+: /, "").trim() }));
}

/** 10. 地図・README に書いた `パス` の実在。パスらしいもの (/ を含み、拡張子か末尾の / がある) だけを見る */
const PATH_DOCS = ["docs/codemap.md", "backend/src/handlers/README.md", "backend/src/security/README.md", "shared/src/README.md", "frontend/src/components/process-flow/story/README.md"];
export function codemapPathIssues(base) {
  const out = [];
  for (const rel of PATH_DOCS) {
    const doc = path.join(base, rel);
    if (!fs.existsSync(doc)) continue;
    const dir = path.dirname(rel);
    for (const m of fs.readFileSync(doc, "utf8").matchAll(/`([A-Za-z0-9_.\-/]+(?:\/|\.[a-z]{2,5}))`/g)) {
      const p = m[1];
      if (!p.includes("/") && !/\.(ts|tsx|json|md|mjs|css)$/.test(p)) continue;
      if (/^https?:|^npm|\*/.test(p)) continue;
      // README は同じディレクトリのファイル名だけを書く。地図はリポジトリの根からの相対
      const candidates = rel === "docs/codemap.md" ? [p] : [path.join(dir, p), p];
      if (!candidates.some((c) => fs.existsSync(path.join(base, c)))) out.push({ file: rel, message: `実在しないパスです: ${p}` });
    }
  }
  return [...new Map(out.map((o) => [`${o.file}|${o.message}`, o])).values()];
}

export function runChecks(base = root) {
  const errors = [], infos = [];
  const files = listDocs(base);
  for (const b of brokenLinks(files, base)) errors.push({ kind: "リンク", file: b.file, message: `リンクの先がありません: ${b.link}` });
  for (const u of unknownNpmScripts(files, base)) errors.push({ kind: "npm", file: u.file, message: `npm run ${u.script} が、どの package.json にもありません` });
  const shellPath = path.join(base, "frontend/src/components/AppShell.tsx");
  const agentsPath = path.join(base, "AGENTS.md");
  let routes = new Set();
  if (fs.existsSync(shellPath) && fs.existsSync(agentsPath)) {
    const shell = fs.readFileSync(shellPath, "utf8");
    routes = appRoutes(shell);
    const drift = routeTableDrift(shell, fs.readFileSync(agentsPath, "utf8"));
    for (const r of drift.missingInDocs) errors.push({ kind: "経路", file: "AGENTS.md", message: `Routing の表にない画面の経路: ${r}` });
    for (const r of drift.missingInApp) errors.push({ kind: "経路", file: "AGENTS.md", message: `Routing の表にあるが、画面にない経路: ${r}` });
  }
  const ui = uiReferenceIssues(base, routes);
  // スクリーンショットの画像のリンクは、リンクの検査でも拾うので、同じものを二重に出さない
  const linkErrs = new Set(errors.filter((e) => e.kind === "リンク").map((e) => `${e.file}|${e.message.split(": ").pop()}`));
  for (const e of ui.errors) if (!(e.message.startsWith("スクリーンショットがありません") && linkErrs.has(`${e.file}|${e.message.split(": ").pop()}`))) errors.push({ kind: "UI 操作リファレンス", ...e });
  for (const i of ui.infos) infos.push({ kind: "資料なし", ...i });
  for (const s of staleShots(ui.docs, base)) infos.push({ kind: "スクリーンショット", ...s });
  const claude = path.join(base, "CLAUDE.md");
  if (fs.existsSync(claude)) {
    const sk = skillIssues(fs.readFileSync(claude, "utf8"), base);
    for (const e of sk.errors) errors.push({ kind: "スキル", ...e });
    for (const i of sk.infos) infos.push({ kind: "スキル", ...i });
  }
  for (const g of specIndexGaps(base)) infos.push({ kind: "仕様書の索引", ...g });
  for (const f of specFrontmatterIssues(base)) errors.push({ kind: "仕様書の frontmatter", ...f });
  for (const t of aiIndexToolIssues(base)) errors.push({ kind: "AI 向けの資料", ...t });
  for (const g of generatedIssues(base)) errors.push({ kind: "自動生成の資料", ...g });
  for (const j of jsonExampleIssues(base)) errors.push({ kind: "JSON の例", ...j });
  for (const c of codemapPathIssues(base)) errors.push({ kind: "コードの地図", ...c });
  return { errors, infos, docCount: files.length };
}

function main() {
  const args = process.argv.slice(2);
  const { errors, infos, docCount } = runChecks();
  const strict = args.includes("--strict");
  for (const e of errors) console.error(`✗ [${e.kind}] ${e.file ? `${e.file}: ` : ""}${e.message}`);
  if (args.includes("--info") || strict) for (const i of infos) console.log(`・[${i.kind}] ${i.file ? `${i.file}: ` : ""}${i.message}`);
  console.log(`資料 ${docCount} 件を検査: 食い違い ${errors.length} 件${infos.length ? ` / 知らせ ${infos.length} 件 (--info で表示)` : ""}`);
  process.exit(errors.length || (strict && infos.length) ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
