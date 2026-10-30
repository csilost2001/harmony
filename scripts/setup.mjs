#!/usr/bin/env node
/**
 * setup — 初回のセットアップを、1 つのコマンドで。
 *   npm run setup                 診断して、足りないものをそろえる (npm install・共有パッケージのビルド・workspaces/ の作成)
 *   npm run setup -- --check      診断だけ (何も変えない。足りなければ終了コード 1)。Node と npm の版も見る
 *                                 (engines・.nvmrc との食い違い。ネットワークは使わない。最新の版との比較は npm run check:deps -- runtime)
 *   npm run setup -- --sample retail   サンプルを workspaces/retail に複製する (そのまま開いて試せる)
 *   npm run setup -- --skip-install    npm install を飛ばす
 * 終わると、起動のしかたを案内する。Dev Containers を使う場合は、docs/setup/dev-containers.md の手順 (このコマンドは中でも使える)。
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fileExists, planSetup, runtimeFindings } from "./lib/setup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const checkOnly = flag("--check");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const npmV = spawnSync("npm", ["-v"], { encoding: "utf8", shell: process.platform === "win32" });
const npmVersion = npmV.status === 0 ? npmV.stdout.trim() : null;
const nvmrcPath = path.join(root, ".nvmrc");
const nvmrc = fs.existsSync(nvmrcPath) ? fs.readFileSync(nvmrcPath, "utf8") : undefined;

const run = (cmd, a, cwd = root) => {
  console.log(`  $ ${cmd} ${a.join(" ")}`);
  return spawnSync(cmd, a, { cwd, stdio: "inherit", shell: process.platform === "win32" }).status === 0;
};
const portBusy = (port) => new Promise((resolve) => { const s = net.connect({ port, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); resolve(true); }); s.once("error", () => resolve(false)); s.setTimeout(500, () => { s.destroy(); resolve(false); }); });

console.log("Harnize Harmony のセットアップ\n");
const git = spawnSync("git", ["--version"], { encoding: "utf8" });
console.log(`  Node.js ${process.version}`);
console.log(`  npm     ${npmVersion ?? "(見つかりません)"}`);
console.log(`  git     ${git.status === 0 ? git.stdout.trim().replace(/^git version /, "") : "(見つかりません。なくても動きますが、「連携と運用」の Git は使えません)"}`);

const plan = planSetup({ root, nodeVersion: process.version, pkg, has: fileExists(root), sample: val("--sample"), skipInstall: flag("--skip-install") });
// Node が engines 未満という指摘は planSetup が先に出すので、ここでは重ねない
const rt = runtimeFindings({ nodeVersion: process.version, npmVersion, nvmrc, pkg, includeNodeEngines: false });
plan.problems.push(...rt.problems);
for (const p of plan.problems) console.error(`\n✗ ${p}`);
for (const n of rt.notices) console.log(`\n・${n}`);
const busy = [];
for (const [port, name] of [[5179, "backend"], [5173, "frontend"]]) if (await portBusy(port)) busy.push(`${port} (${name})`);
if (busy.length) console.log(`\n・ポート ${busy.join("・")} は、すでに使われています (起動済みなら、そのまま使えます。止めるには npm run kill)`);

if (plan.steps.length === 0 && plan.problems.length === 0) console.log("\n✓ すべてそろっています。");
else if (plan.steps.length) console.log(`\n${checkOnly ? "足りないもの" : "これから行うこと"}:\n${plan.steps.map((s) => `  ・${s.label}`).join("\n")}`);
if (checkOnly) process.exit(plan.problems.length || plan.steps.length ? 1 : 0);
if (plan.problems.length) process.exit(1);

for (const s of plan.steps) {
  console.log(`\n▶ ${s.label}`);
  let ok = true;
  if (s.id === "install") ok = run("npm", ["install"]);
  else if (s.id === "build-shared") ok = run("npm", ["run", "build", "--workspace=@harmony/shared"]);
  else if (s.id === "mkdir-workspaces") fs.mkdirSync(path.join(root, "workspaces"), { recursive: true });
  else if (s.id === "copy-sample") fs.cpSync(path.join(root, "examples", val("--sample")), path.join(root, "workspaces", val("--sample")), { recursive: true });
  if (!ok) { console.error(`\n✗ 「${s.label}」に失敗しました。上の出力を確認して、もう一度 npm run setup を実行してください`); process.exit(1); }
}

console.log(`
✓ セットアップが終わりました。起動のしかた:
  1. ターミナル A:  npm run backend    (port 5179。常駐)
  2. ターミナル B:  npm run frontend   (port 5173)
  3. ブラウザで http://localhost:5173 を開き、「ワークスペースを開く」で${val("--sample") ? ` workspaces/${val("--sample")} を` : "フォルダを"}指定する
  AI (Claude Code / Codex) から使うときは、backend を起動したまま、.mcp.json の http://localhost:5179/mcp に接続します。
  止めるとき: npm run kill     詳しい手順: README.md / docs/setup/`);
