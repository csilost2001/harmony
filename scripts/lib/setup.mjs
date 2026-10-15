/** npm run setup の、判断の部分 (副作用なし)。scripts/setup.mjs が使う。試験: scripts/verify/test.mjs */
import fs from "node:fs";
import path from "node:path";

/** "v22.3.1" → [22, 3, 1] */
export const parseVersion = (v) => String(v).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
export function versionAtLeast(actual, min) {
  const a = parseVersion(actual), b = parseVersion(min);
  for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); }
  return true;
}

/** 必要な Node の版 (package.json の engines。無ければ 20) */
export function requiredNode(pkg) {
  const m = /(\d+(?:\.\d+){0,2})/.exec(pkg?.engines?.node ?? "");
  return m ? m[1] : "20";
}

/** やることの計画: 何がそろっていて、何をするか */
export function planSetup({ root, nodeVersion, pkg, has, sample, skipInstall }) {
  const steps = [];
  const problems = [];
  const need = requiredNode(pkg);
  if (!versionAtLeast(nodeVersion, need)) problems.push(`Node.js ${need} 以上が必要です (いま: ${nodeVersion})`);
  if (!has("node_modules") && !skipInstall) steps.push({ id: "install", label: "依存パッケージを入れる (npm install)" });
  else if (!has("node_modules")) problems.push("node_modules がありません (npm install が必要です)");
  if (!has("shared/dist/index.js")) steps.push({ id: "build-shared", label: "共有パッケージをビルドする (@harmony/shared)" });
  if (!has("workspaces")) steps.push({ id: "mkdir-workspaces", label: "workspaces/ フォルダを作る (利用者の設計の置き場所)" });
  if (sample) {
    if (!has(`examples/${sample}/harmony.json`)) problems.push(`サンプル「${sample}」が、examples/ にありません`);
    else if (!has(`workspaces/${sample}`)) steps.push({ id: "copy-sample", label: `サンプル「${sample}」を workspaces/${sample} に複製する` });
  }
  return { steps, problems, root: path.resolve(root) };
}

export function fileExists(root) { return (rel) => fs.existsSync(path.join(root, rel)); }
