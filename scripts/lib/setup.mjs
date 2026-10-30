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

/** engines の下限 (">=26" → "26"。"^22.22.2 || >=26" のように複数ならいちばん小さい数。読めなければ null) */
export function requiredEngine(pkg, name) {
  const nums = [...String(pkg?.engines?.[name] ?? "").matchAll(/(\d+(?:\.\d+){0,2})/g)].map((m) => m[1]);
  if (nums.length === 0) return null;
  return nums.reduce((lo, n) => (versionAtLeast(lo, n) ? n : lo));
}

/** .nvmrc の中身 ("26"・"v26.1.0") から Node のメジャーを取る。"lts/*"・"node" のように数字で決まらないものは null */
export function nvmrcMajor(nvmrc) {
  const m = /^v?(\d+)(?:\.|$)/.exec(String(nvmrc ?? "").trim());
  return m ? Number(m[1]) : null;
}

const majorOf = (v) => parseVersion(v)[0];

/**
 * 動かしている Node と npm が、そろっているかの判定 (副作用なし)。
 *   nodeVersion / npmVersion  いま動いている版 ("v26.13.0" / "12.2.1")
 *   nvmrc                     .nvmrc の中身 (無ければ省略)
 *   pkg                       ルートの package.json (engines を見る)
 *   releases                  https://nodejs.org/dist/index.json の配列 ({ version, lts, npm })。ネットワークを使わない検査では省略
 *   latestNpm                 `npm view npm version` の結果。同上
 *   includeNodeEngines        false なら「Node が engines 未満」を出さない (planSetup が先に言うので、重複させないため)
 * 戻り値: { problems: 直すべきこと, notices: 知らせ }
 */
export function runtimeFindings({ nodeVersion, npmVersion, nvmrc, pkg, releases, latestNpm, includeNodeEngines = true }) {
  const problems = [];
  const notices = [];
  const needNode = requiredEngine(pkg, "node");
  const needNpm = requiredEngine(pkg, "npm");
  if (includeNodeEngines && needNode && !versionAtLeast(nodeVersion, needNode)) {
    problems.push(`Node.js ${needNode} 以上が必要です (いま: ${nodeVersion})`);
  }
  if (npmVersion && needNpm && !versionAtLeast(npmVersion, needNpm)) {
    problems.push(`npm ${needNpm} 以上が必要です (いま: ${npmVersion})。npm install -g npm@latest で上げてください。古い npm で npm install すると、package-lock.json の libc の欄が消えるなど、lock が書き換わります`);
  }
  const want = nvmrcMajor(nvmrc);
  if (want !== null && majorOf(nodeVersion) !== want) {
    notices.push(`動いている Node (${nodeVersion}) が、.nvmrc (${want}) と違います。nvm use で合わせてください。VS Code から開いた端末は VS Code を起動したときの環境を引き継ぐので、直らなければ VS Code を開き直してください`);
  }
  if (Array.isArray(releases) && releases.length > 0) {
    const lts = releases.filter((r) => r.lts).map((r) => majorOf(r.version));
    const newestLts = lts.length ? Math.max(...lts) : null;
    if (want !== null && newestLts !== null && newestLts > want) {
      problems.push(`新しい LTS のメジャー (Node ${newestLts}) が出ています (.nvmrc は ${want})。docs/setup/dev-containers.md の「Node のメジャーを上げる手順」に沿って上げてください`);
    }
    const same = releases.map((r) => r.version).filter((v) => majorOf(v) === majorOf(nodeVersion));
    const newest = same.reduce((hi, v) => (hi === null || !versionAtLeast(hi, v) ? v : hi), null);
    if (newest && !versionAtLeast(nodeVersion, newest)) {
      problems.push(`動いている Node (${nodeVersion}) が、同じメジャーの最新 (${newest}) より古いです。ホストは nvm install ${majorOf(nodeVersion)} で入れ直し、Dev Containers は Rebuild Container (Without Cache) してください`);
    }
  }
  if (latestNpm && npmVersion && !versionAtLeast(npmVersion, latestNpm)) {
    problems.push(`npm (${npmVersion}) が最新 (${latestNpm}) より古いです。npm install -g npm@latest で上げてください (Dev Containers は Rebuild Without Cache)`);
  }
  return { problems, notices };
}
