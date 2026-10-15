#!/usr/bin/env node
/**
 * docs-shots — UI 操作リファレンスのスクリーンショット (docs/ui-screenshots/ui-reference/<画面>/01-default.png) を、いまの画面で撮り直す。
 * 既定は、画面のコードより古くなっているものだけ (npm run check:docs -- --info の「スクリーンショット」)。--all で、対応するものすべて。
 * dev server が未起動なら、ui:shots が起動して、終了時に止める。撮り直したあとは、差分を見て、必要なものだけをコミットする。
 *
 * 使い方: npm run docs:shots [-- --all] [-- --only table-list,tech-stack] [-- --dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runChecks } from "../verify/docs-freshness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** UI 操作リファレンスの名前 → ui-shots の名前 (scripts/dev/ui-shots.mjs の routes)。ここにあるものだけ、自動で撮り直せる */
export const DOC_SHOT_NAMES = {
  dashboard: "dashboard", "screen-flow": "screen-flow", "screen-list": "screen-list", "screen-items": "screen-items", "table-list": "table-list", "table-editor": "table-edit",
  "er-diagram": "er", "process-flow-list": "process-flow-list", "process-flow-editor": "process-flow-edit", "sequence-list": "sequence-list", "sequence-editor": "sequence-edit",
  "view-list": "view-list", "view-editor": "view-edit", "view-definition-list": "view-definition-list", "view-definition-editor": "view-definition-edit",
  "generic-definition-list": "generic-definition-list", "generic-definition-catalog": "generic-definition", "page-layout-list": "page-layout-list", "page-layout-editor": "page-layout-edit",
  "gadget-list": "gadget-list", "conventions-catalog": "conventions", extensions: "extensions", "tech-stack": "tech-stack", document: "document", analysis: "analysis", operations: "operations",
  "report-list": "report-list", "business-flow": "business-flow-list",
};

/** 撮り直す対象 (資料の名前の一覧) を決める */
export function pickTargets({ all, only, staleDocs, existing }) {
  const names = only?.length ? only : all ? Object.keys(DOC_SHOT_NAMES) : staleDocs;
  return names.filter((n) => DOC_SHOT_NAMES[n] && existing(n));
}

function main() {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const shotDir = (n) => path.join(root, "docs/ui-screenshots/ui-reference", n);
  const stale = runChecks().infos.filter((i) => i.kind === "スクリーンショット").map((i) => path.basename(i.file, ".md"));
  const targets = pickTargets({ all: args.includes("--all"), only: val("--only")?.split(",").filter(Boolean), staleDocs: stale, existing: (n) => fs.existsSync(path.join(shotDir(n), "01-default.png")) });
  if (!targets.length) { console.log("撮り直すスクリーンショットはありません (古くなっているものがないか、対応する画面がありません)"); return; }
  console.log(`撮り直す: ${targets.join(", ")}`);
  if (args.includes("--dry-run")) return;
  const out = path.join(root, ".tmp/screenshots/docs-refresh");
  fs.rmSync(out, { recursive: true, force: true });
  const names = [...new Set(targets.map((t) => DOC_SHOT_NAMES[t]))];
  const r = spawnSync("node", ["scripts/dev/ui-shots.mjs", "--out", out, "--only", names.join(",")], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  for (const t of targets) {
    const src = path.join(out, `${DOC_SHOT_NAMES[t]}.png`);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(shotDir(t), "01-default.png")); console.log(`更新: docs/ui-screenshots/ui-reference/${t}/01-default.png`); }
  }
  console.log("差分を確かめて、必要なものだけをコミットしてください (git diff --stat docs/ui-screenshots)");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
