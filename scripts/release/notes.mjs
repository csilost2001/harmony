#!/usr/bin/env node
/**
 * release:notes — git の履歴から、リリースノート (docs/release-notes.md) を作る。
 *   npm run release:notes                     main (または、いまのブランチ) の履歴から作り直して、docs/release-notes.md に書く
 *   npm run release:notes -- --since <ref>   その ref の後ろだけ
 *   npm run release:notes -- --ref origin/main   その ref (既定は HEAD) の履歴から作る
 *   npm run release:notes -- --stdout        ファイルに書かず、標準出力に出す
 * 1 コミット (squash merge の 1 PR) = 1 行: `- YYYY-MM-DD タイトル (#PR 番号)`。新しい順。アプリの「連携と運用 → 版と更新」が読む。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** `git log` の 1 行 ("<日付>\x1f<件名>") から、リリースノートの 1 行へ。PR 番号 (件名の末尾の (#N)。複数あれば最後) を取り出す */
export function toNoteLine(line) {
  const [date, subjectRaw] = line.split("\x1f");
  if (!date || !subjectRaw) return null;
  let subject = subjectRaw.trim();
  if (/^(Merge |Revert "Merge )/.test(subject)) return null;
  const prs = [...subject.matchAll(/\(#(\d+)\)/g)].map((m) => m[1]);
  subject = subject.replace(/\s*\(#\d+\)/g, "").trim();
  if (!subject) return null;
  return `- ${date} ${subject}${prs.length ? ` (#${prs.at(-1)})` : ""}`;
}

export function renderNotes(lines) {
  return `# リリースノート\n\n取り込まれた変更の一覧です (新しい順)。\`npm run release:notes\` が、git の履歴から作ります。手で書き換えても、次に作り直すと消えます。\n\n${lines.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const since = val("--since");
  const r = spawnSync("git", ["log", "--first-parent", "--date=short", "--pretty=format:%ad%x1f%s", ...(since ? [`${since}..${val("--ref") ?? "HEAD"}`] : [val("--ref") ?? "HEAD"]), "-n", "400"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`git log に失敗しました: ${r.stderr.trim()}`); process.exit(1); }
  const lines = r.stdout.split("\n").map(toNoteLine).filter(Boolean);
  const md = renderNotes(lines);
  if (args.includes("--stdout")) { process.stdout.write(md); return; }
  fs.writeFileSync(path.join(root, "docs/release-notes.md"), md);
  console.log(`docs/release-notes.md を作りました (${lines.length} 件)`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
