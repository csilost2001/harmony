/**
 * 版の情報とリリースノート。版 = ルートの package.json の version、コミット = git の短縮 SHA (git の作業コピーのときだけ)。
 * リリースノートは `docs/release-notes.md` (scripts/release/notes.mjs が git の履歴から作る)。画面は「前回見た版」と比べて、更新の案内を出す。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { runGit, type GitRunner } from "./gitOps.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");

export interface ReleaseNote { date: string; title: string; pr?: string }
export interface VersionInfo { version: string; commit?: string; branch?: string; dirty?: boolean; startedAt: string; notes: ReleaseNote[]; notesTotal: number }

const STARTED = new Date().toISOString();

/** `- 2026-10-14 タイトル (#123)` の行 */
export function parseReleaseNotes(md: string): ReleaseNote[] {
  const out: ReleaseNote[] = [];
  for (const line of md.split("\n")) {
    const m = /^- (\d{4}-\d{2}-\d{2}) (.+?)(?: \(#(\d+)\))?\s*$/.exec(line);
    if (m) out.push({ date: m[1], title: m[2], ...(m[3] ? { pr: m[3] } : {}) });
  }
  return out;
}

export async function readVersionInfo(run: GitRunner = runGit, projectRoot = PROJECT_ROOT, limit = 30): Promise<VersionInfo> {
  let version = "0.0.0";
  try { const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf-8")) as { version?: unknown }; if (typeof pkg.version === "string") version = pkg.version; } catch { /* 版が読めなくても、画面は動く */ }
  let commit: string | undefined, branch: string | undefined, dirty: boolean | undefined;
  try {
    const top = await run(projectRoot, ["rev-parse", "--show-toplevel"]);
    if (top.code === 0 && path.resolve(top.stdout.trim()) === path.resolve(projectRoot)) {
      commit = (await run(projectRoot, ["rev-parse", "--short", "HEAD"])).stdout.trim() || undefined;
      branch = (await run(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim() || undefined;
      dirty = (await run(projectRoot, ["status", "--porcelain", "--untracked-files=no"])).stdout.trim().length > 0;
    }
  } catch { /* git が無い・作業コピーでない (配布物) */ }
  let notes: ReleaseNote[] = [];
  try { notes = parseReleaseNotes(await fs.readFile(path.join(projectRoot, "docs", "release-notes.md"), "utf-8")); } catch { /* 無ければ空 */ }
  return { version, ...(commit ? { commit } : {}), ...(branch ? { branch } : {}), ...(dirty !== undefined ? { dirty } : {}), startedAt: STARTED, notes: notes.slice(0, limit), notesTotal: notes.length };
}

/** 本体のリポジトリの、最新の main との差 (利用者が「更新を確認」を押したときだけ。リモートへ読み取りの問い合わせをする) */
export async function checkForUpdate(run: GitRunner = runGit, projectRoot = PROJECT_ROOT): Promise<{ status: "current" | "behind" | "unknown"; message: string; local?: string; remote?: string }> {
  try {
    const top = await run(projectRoot, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0 || path.resolve(top.stdout.trim()) !== path.resolve(projectRoot)) return { status: "unknown", message: "git の作業コピーではないため、更新の確認はできません (配布元をご確認ください)" };
    const local = (await run(projectRoot, ["rev-parse", "HEAD"])).stdout.trim();
    const remote = await run(projectRoot, ["ls-remote", "origin", "refs/heads/main"]);
    if (remote.code !== 0 || !remote.stdout.trim()) return { status: "unknown", message: "更新元 (origin) に問い合わせられませんでした。ネットワークとリモートの設定をご確認ください" };
    const sha = remote.stdout.trim().split(/\s+/)[0];
    if (sha === local) return { status: "current", message: "最新です", local: local.slice(0, 7), remote: sha.slice(0, 7) };
    const ancestor = await run(projectRoot, ["merge-base", "--is-ancestor", sha, "HEAD"]);
    return ancestor.code === 0
      ? { status: "current", message: "最新の main より先に進んでいます (ブランチで作業中)", local: local.slice(0, 7), remote: sha.slice(0, 7) }
      : { status: "behind", message: "更新があります。`git pull` で取り込んでから、再起動してください", local: local.slice(0, 7), remote: sha.slice(0, 7) };
  } catch (e) { return { status: "unknown", message: e instanceof Error ? e.message : String(e) }; }
}
