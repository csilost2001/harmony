/**
 * Git 連携: 変更の確認・差分・コミット・ブランチの切り替え・履歴。`git` コマンドを、シェルを通さずに (execFile) 呼ぶ。
 * 範囲: ワークスペースのフォルダの中だけ (`-- .`)。しないこと: push / pull / fetch / merge / rebase / reset / 履歴の書き換え
 * (リモートへ出す・取り込む操作と、元に戻せない操作は、利用者が git を直接使う)。引数は検証し、`-` で始まる値・`..` を含む場所は拒否する。
 */
import { execFile } from "node:child_process";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

export interface GitRun { stdout: string; stderr: string; code: number }

export type GitRunner = (cwd: string, args: string[]) => Promise<GitRun>;

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;

/**
 * 利用者のワークスペースのリポジトリの設定 (.git/config) には、コマンドを実行させる項目がある (core.fsmonitor・core.hooksPath・diff.external・
 * core.sshCommand など)。他人から受け取ったワークスペースで、状態を見ただけでコマンドが走らないよう、これらを無効にして呼ぶ。
 * フィルタ (clean / smudge)・textconv・マージドライバなども、リポジトリの設定にあるものは空にする (設定の項目名だけを先に読み、`-c 名前=` で上書き)。
 * コミットの署名は、gpg.program がコマンドを実行するので、無効にする。コミットのフックは、--no-verify で走らせない。
 * (利用者の git の設定のうち、名前・メールなどは、そのまま使う)
 */
export const SAFE_GIT_CONFIG = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${os.devNull}`, "-c", "diff.external=", "-c", "core.sshCommand=", "-c", "core.pager=cat", "-c", "protocol.ext.allow=never", "-c", "core.untrackedCache=false"];

/** コミットの署名 (gpg.program はコマンドを実行する)・外部のコマンドで内容を変換する項目 */
const SAFE_GIT_CONFIG_2 = ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "gpg.program=", "-c", "gpg.ssh.program=", "-c", "gpg.x509.program="];
/** リポジトリ (.git/config) が、コマンドを実行させる項目: フィルタ (clean / smudge / process)・textconv・マージドライバ・エイリアスなど */
const EXEC_KEY = /^(filter\..+\.(clean|smudge|process)|diff\..+\.(textconv|command)|merge\..+\.(driver|recursive)|difftool\..+\.cmd|mergetool\..+\.cmd|credential\..*helper|credential\.helper|core\.(editor|askpass|fsmonitor|hookspath|sshcommand|pager|gitproxy)|sequence\.editor|receive\.|uploadpack\.|remote\..+\.(uploadpack|receivepack|vcs|proxy)|url\..+\.insteadof|http\.proxy)$/i;

/** そのリポジトリの設定のうち、コマンドを実行させる項目を、空にして呼ぶための `-c` の並び (設定を読むだけで、実行はしない) */
export function execOverrides(localConfigNames: string[]): string[] {
  const out: string[] = [];
  for (const name of new Set(localConfigNames)) if (EXEC_KEY.test(name) && !/[\r\n=]/.test(name)) out.push("-c", `${name}=`);
  return out;
}

const execGit = (cwd: string, args: string[]): Promise<GitRun> => new Promise((resolve, reject) => {
  execFile("git", args, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", LC_ALL: "C.UTF-8", GIT_OPTIONAL_LOCKS: "0", GIT_EXTERNAL_DIFF: "", GIT_SSH_COMMAND: "" }, windowsHide: true }, (err, stdout, stderr) => {
    if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return reject(new Error("git が見つかりません。git をインストールしてください"));
    const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
    if (err && (err as { killed?: boolean }).killed) return reject(new Error("git の応答がありません (15 秒)"));
    resolve({ stdout: String(stdout), stderr: String(stderr), code });
  });
});

/** リポジトリの設定の項目名 (値は読まない)。リポジトリでなければ、空 */
async function localConfigNames(cwd: string): Promise<string[]> {
  const out: string[] = [];
  // .git/config と、ワークツリー専用の設定 (extensions.worktreeConfig のときの .git/config.worktree)。どちらも、他人から受け取ったものでありうる
  for (const scope of ["--local", "--worktree"]) {
    try {
      const r = await execGit(cwd, [...SAFE_GIT_CONFIG, "config", scope, "--includes", "-z", "--name-only", "--list"]);
      if (r.code === 0) out.push(...r.stdout.split("\0").filter(Boolean));
    } catch { /* リポジトリでない・その範囲の設定が無い */ }
  }
  return out;
}

export const runGit: GitRunner = async (cwd, args) => execGit(cwd, [...SAFE_GIT_CONFIG, ...SAFE_GIT_CONFIG_2, ...execOverrides(await localConfigNames(cwd)), ...args]);

export interface GitFile { path: string; /** 例: M (変更) A (追加) D (削除) R (改名) ? (未追跡) U (競合) */ status: string; staged: boolean }
export interface GitStatus {
  isRepo: boolean;
  /** このワークスペース自身が git のルートか (上の階層のリポジトリの一部ではない) */
  ownRepo: boolean;
  branch?: string;
  detached?: boolean;
  files: GitFile[];
  clean: boolean;
  /** 利用者名 / メールが git に設定されているか */
  identityConfigured: boolean;
}

/** 場所の検査 (相対・外へ出ない・先頭が `-` でない・制御文字なし) */
export function assertGitPath(p: unknown): string {
  if (typeof p !== "string" || !p || p.length > 500 || p.includes("\0") || /[\r\n]/.test(p)) throw new Error("ファイルの場所が正しくありません");
  const n = p.replace(/\\/g, "/");
  if (n.startsWith("/") || n.startsWith("-") || /^[A-Za-z]:/.test(n) || n.split("/").some((s) => s === ".." )) throw new Error(`ファイルの場所が正しくありません: ${p}`);
  return n;
}
export function assertBranchName(b: unknown): string {
  if (typeof b !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(b) || b.includes("..") || b.endsWith("/") || b.endsWith(".lock")) throw new Error("ブランチ名が正しくありません (英数字・ . _ / - だけ、100 文字まで)");
  return b;
}

const fail = (r: GitRun, what: string): never => { throw new Error(`${what}に失敗しました: ${(r.stderr || r.stdout).trim().split("\n").slice(0, 3).join(" ") || `終了コード ${r.code}`}`); };

export async function gitStatus(root: string, run: GitRunner = runGit): Promise<GitStatus> {
  const empty: GitStatus = { isRepo: false, ownRepo: false, files: [], clean: true, identityConfigured: false };
  const top = await run(root, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return empty;
  const topDir = await fs.realpath(top.stdout.trim()).catch(() => top.stdout.trim());
  const rootReal = await fs.realpath(root).catch(() => root);
  const ownRepo = path.resolve(topDir) === path.resolve(rootReal);
  // 上の階層のリポジトリが、このワークスペースを無視している (workspaces/ が .gitignore) なら、「リポジトリではない」として扱う
  if (!ownRepo && (await run(root, ["check-ignore", "-q", "."])).code === 0) return empty;
  const st = await run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  if (st.code !== 0) fail(st, "状態の取得");
  const files: GitFile[] = [];
  const parts = st.stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1];
    let file = e.slice(3);
    if (x === "R" || x === "C") i++; // 改名・コピーは、元の名前が次に来る
    const status = x === "?" ? "?" : x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D") ? "U" : (y !== " " ? y : x);
    // porcelain の場所は、リポジトリのルートからの相対。ワークスペースからの相対にする
    if (!ownRepo) { const rel = path.posix.relative(path.relative(topDir, rootReal).split(path.sep).join("/"), file); file = rel; }
    files.push({ path: file, status, staged: x !== " " && x !== "?" });
  }
  const br = await run(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const name = (await run(root, ["config", "user.name"])).stdout.trim();
  const email = (await run(root, ["config", "user.email"])).stdout.trim();
  const branch = br.code === 0 ? br.stdout.trim() : (await run(root, ["symbolic-ref", "--short", "HEAD"])).stdout.trim() || undefined;
  return { isRepo: true, ownRepo, ...(branch ? { branch } : {}), ...(branch === "HEAD" ? { detached: true } : {}), files, clean: files.length === 0, identityConfigured: !!name && !!email };
}

export async function gitDiff(root: string, file: string, run: GitRunner = runGit): Promise<{ diff: string; truncated: boolean }> {
  const p = assertGitPath(file);
  const st = await gitStatus(root, run);
  const f = st.files.find((x) => x.path === p);
  if (!f) throw new Error("そのファイルには、変更がありません");
  const MAX = 200_000;
  let out: GitRun;
  if (f.status === "?") {
    // 未追跡: 全部が追加された差分として見せる
    const empty = process.platform === "win32" ? "NUL" : "/dev/null";
    out = await run(root, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-index", "--", empty, p]);
    if (out.code > 1) fail(out, "差分の取得");
  } else {
    const hasHead = (await run(root, ["rev-parse", "--verify", "-q", "HEAD"])).code === 0;
    out = await run(root, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "-U3", ...(hasHead ? ["HEAD"] : ["--cached"]), "--", p]);
    if (out.code !== 0) fail(out, "差分の取得");
  }
  return { diff: out.stdout.slice(0, MAX), truncated: out.stdout.length > MAX };
}

export interface CommitInput { message: string; paths: string[]; actor?: string }
export async function gitCommit(root: string, input: CommitInput, run: GitRunner = runGit): Promise<{ commit: string; files: number }> {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new Error("コミットのメッセージを書いてください");
  if (message.length > 2000) throw new Error("メッセージが長すぎます (2000 文字まで)");
  if (!Array.isArray(input.paths) || !input.paths.length) throw new Error("コミットするファイルを選んでください");
  if (input.paths.length > 2000) throw new Error("選んだファイルが多すぎます (2000 件まで)");
  const paths = [...new Set(input.paths.map(assertGitPath))];
  const st = await gitStatus(root, run);
  if (!st.isRepo) throw new Error("このワークスペースは git のリポジトリではありません");
  const known = new Set(st.files.map((f) => f.path));
  const missing = paths.filter((p) => !known.has(p));
  if (missing.length) throw new Error(`変更のないファイルが含まれています: ${missing.slice(0, 3).join(", ")}`);
  if (st.files.some((f) => f.status === "U")) throw new Error("競合している (マージ中の) ファイルがあります。git で解決してから、コミットしてください");
  const add = await run(root, ["add", "-A", "--", ...paths]);
  if (add.code !== 0) fail(add, "ステージ");
  // 名前・メールが未設定のときだけ、操作した人の名前を使う
  const actor = (input.actor ?? "").replace(/[\r\n<>]/g, " ").trim().slice(0, 40) || "Harmony";
  const idArgs = st.identityConfigured ? [] : ["-c", `user.name=${actor}`, "-c", "user.email=harmony@localhost"];
  const commit = await run(root, [...idArgs, "commit", "--no-verify", "-m", message, "--only", "--", ...paths]);
  if (commit.code !== 0) fail(commit, "コミット");
  const head = await run(root, ["rev-parse", "--short", "HEAD"]);
  return { commit: head.stdout.trim(), files: paths.length };
}

export interface GitCommitInfo { hash: string; author: string; at: string; subject: string }
export async function gitLog(root: string, limit = 30, run: GitRunner = runGit): Promise<GitCommitInfo[]> {
  const n = Math.min(Math.max(Math.floor(limit), 1), 200);
  const r = await run(root, ["log", `-n${n}`, "--pretty=format:%h%x1f%an%x1f%aI%x1f%s", "--", "."]);
  if (r.code !== 0) return []; // 履歴が無い (最初のコミット前) など
  return r.stdout.split("\n").filter(Boolean).map((l) => { const [hash, author, at, subject] = l.split("\x1f"); return { hash, author, at, subject }; });
}

export async function gitBranches(root: string, run: GitRunner = runGit): Promise<Array<{ name: string; current: boolean }>> {
  // ブランチ名に空白は使えないので、空白で区切る (--format の %x1f は、branch では使えない)
  const r = await run(root, ["branch", "--format=%(refname:short) %(HEAD)"]);
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter(Boolean).map((l) => { const i = l.lastIndexOf(" "); return { name: l.slice(0, i), current: l.slice(i + 1) === "*" }; }).filter((b) => b.name && !b.name.startsWith("("));
}

/** ブランチの切り替え (変更が残っていれば拒否。create で新しいブランチを作って切り替える) */
export async function gitCheckout(root: string, branch: string, create = false, run: GitRunner = runGit): Promise<{ branch: string }> {
  const name = assertBranchName(branch);
  const st = await gitStatus(root, run);
  if (!st.isRepo) throw new Error("このワークスペースは git のリポジトリではありません");
  if (!st.clean) throw new Error("コミットしていない変更があります。コミットするか、元に戻してから、切り替えてください");
  const r = await run(root, create ? ["checkout", "-b", name] : ["checkout", name, "--"]);
  if (r.code !== 0) fail(r, "ブランチの切り替え");
  return { branch: name };
}

export async function gitInit(root: string, run: GitRunner = runGit): Promise<void> {
  const st = await gitStatus(root, run);
  if (st.isRepo && st.ownRepo) throw new Error("すでに git のリポジトリです");
  const r = await run(root, ["init"]);
  if (r.code !== 0) fail(r, "git init");
}
