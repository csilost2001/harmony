/**
 * 版の情報とリリースノート。版 = ルートの package.json の version、コミット = git の短縮 SHA (git の作業コピーのときだけ)。
 * リリースノートは `docs/release-notes.md` (scripts/release/notes.mjs が git の履歴から作る)。画面は「前回見た版」と比べて、更新の案内を出す。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { runGit, type GitRunner } from "./gitOps.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");

export interface ReleaseNote { date: string; title: string; pr?: string }
/**
 * `source`: 版の出どころ。git = git の作業コピー (commit は短縮) / image = 配布 image の `build-info.json` (image を作ったときの記録)。
 * `commitFull` は完全な SHA (更新の確認で GitHub に渡す)。`builtAt` / `repo` は image のときだけ。
 */
export interface VersionInfo {
  version: string; commit?: string; commitFull?: string; branch?: string; dirty?: boolean; source?: "git" | "image"; builtAt?: string; repo?: string;
  startedAt: string; notes: ReleaseNote[]; notesTotal: number;
}

/** 配布 image の作成時に Dockerfile が書く `/app/build-info.json` (`scripts/build-harmony-image.sh` の build-arg が元) */
export interface BuildInfo { commit: string; branch?: string; dirty?: boolean; builtAt?: string; repo?: string }

const FULL_SHA = /^[0-9a-f]{40}$/;
const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/;
/** `owner/repo` の形。`.` / `..` だけの部分は、API の URL の経路をたどってしまうので除く */
const isGithubRepo = (v: string): boolean => GITHUB_REPO.test(v) && v.split("/").every((p) => !/^\.+$/.test(p));
const GITHUB_API = "https://api.github.com";

const STARTED = new Date().toISOString();

/** `git rev-parse --abbrev-ref HEAD` の答えをブランチ名にする。detached HEAD は `HEAD` と返るので、ブランチ名とは見ない */
export function branchName(raw: string | undefined): string | undefined {
  const b = raw?.trim();
  return b && b !== "HEAD" ? b.slice(0, 200) : undefined;
}

/** `- 2026-10-14 タイトル (#123)` の行 */
export function parseReleaseNotes(md: string): ReleaseNote[] {
  const out: ReleaseNote[] = [];
  for (const line of md.split("\n")) {
    const m = /^- (\d{4}-\d{2}-\d{2}) (.+?)(?: \(#(\d+)\))?\s*$/.exec(line);
    if (m) out.push({ date: m[1], title: m[2], ...(m[3] ? { pr: m[3] } : {}) });
  }
  return out;
}

/** `<projectRoot>/build-info.json` を読む。無い・壊れている・commit が 40 桁の 16 進でないときは undefined (他の項目は、形が合うものだけ取る) */
export async function readBuildInfo(projectRoot = PROJECT_ROOT): Promise<BuildInfo | undefined> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(projectRoot, "build-info.json"), "utf-8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const o = raw as Record<string, unknown>;
    if (typeof o.commit !== "string" || !FULL_SHA.test(o.commit)) return undefined;
    return {
      commit: o.commit,
      ...(typeof o.branch === "string" && branchName(o.branch) ? { branch: branchName(o.branch) } : {}),
      ...(typeof o.dirty === "boolean" ? { dirty: o.dirty } : {}),
      ...(typeof o.builtAt === "string" && !Number.isNaN(Date.parse(o.builtAt)) ? { builtAt: o.builtAt } : {}),
      ...(typeof o.repo === "string" && isGithubRepo(o.repo) ? { repo: o.repo } : {}),
    };
  } catch { return undefined; }
}

export async function readVersionInfo(run: GitRunner = runGit, projectRoot = PROJECT_ROOT, limit = 30): Promise<VersionInfo> {
  let version = "0.0.0";
  try { const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf-8")) as { version?: unknown }; if (typeof pkg.version === "string") version = pkg.version; } catch { /* 版が読めなくても、画面は動く */ }
  let commit: string | undefined, commitFull: string | undefined, branch: string | undefined, dirty: boolean | undefined;
  let source: "git" | "image" | undefined, builtAt: string | undefined, repo: string | undefined;
  try {
    const top = await run(projectRoot, ["rev-parse", "--show-toplevel"]);
    if (top.code === 0 && path.resolve(top.stdout.trim()) === path.resolve(projectRoot)) {
      commit = (await run(projectRoot, ["rev-parse", "--short", "HEAD"])).stdout.trim() || undefined;
      branch = branchName((await run(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout);
      dirty = (await run(projectRoot, ["status", "--porcelain", "--untracked-files=no"])).stdout.trim().length > 0;
      const full = (await run(projectRoot, ["rev-parse", "HEAD"])).stdout.trim();
      commitFull = FULL_SHA.test(full) ? full : undefined;
      source = "git";
    }
  } catch { /* git が無い・作業コピーでない (配布物) */ }
  if (!source) {
    const bi = await readBuildInfo(projectRoot);
    if (bi) { source = "image"; commitFull = bi.commit; commit = bi.commit.slice(0, 7); branch = bi.branch; dirty = bi.dirty; builtAt = bi.builtAt; repo = bi.repo; }
  }
  let notes: ReleaseNote[] = [];
  try { notes = parseReleaseNotes(await fs.readFile(path.join(projectRoot, "docs", "release-notes.md"), "utf-8")); } catch { /* 無ければ空 */ }
  return { version, ...(commit ? { commit } : {}), ...(commitFull ? { commitFull } : {}), ...(source ? { source } : {}), ...(builtAt ? { builtAt } : {}), ...(repo ? { repo } : {}), ...(branch ? { branch } : {}), ...(dirty !== undefined ? { dirty } : {}), startedAt: STARTED, notes: notes.slice(0, limit), notesTotal: notes.length };
}

export interface UpdateCheck { status: "current" | "behind" | "unknown"; message: string; local?: string; remote?: string; behindBy?: number; aheadBy?: number }
type FetchFn = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** 配布 image の commit を、GitHub の main と比べる (認証なし・読み取り・10 秒で打ち切り)。repo と commit は形を検査してから URL に入れる */
async function checkImageUpdate(bi: BuildInfo, fetchFn: FetchFn): Promise<UpdateCheck> {
  const short = bi.commit.slice(0, 7);
  if (!bi.repo) return { status: "unknown", message: "image に取得元 (GitHub の repo) の記録がないため、更新を確かめられません", local: short };
  if (!isGithubRepo(bi.repo) || !FULL_SHA.test(bi.commit)) return { status: "unknown", message: "image の記録 (取得元・commit) の形が正しくないため、更新を確かめられません", local: short };
  try {
    const res = await fetchFn(`${GITHUB_API}/repos/${bi.repo}/compare/${bi.commit}...main?per_page=1`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "harmony-update-check" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { status: "unknown", message: "記録した commit が GitHub にありません (push していないブランチから作った image など)", local: short };
    if (res.status === 403 || res.status === 429) return { status: "unknown", message: `確かめられません (GitHub の問い合わせの回数制限か、アクセスの制限です。HTTP ${res.status}。認証なしの問い合わせは 1 時間に 60 回までなので、しばらくしてからもう一度お試しください)`, local: short };
    if (!res.ok) return { status: "unknown", message: `確かめられません (GitHub が HTTP ${res.status} を返しました)`, local: short };
    const body = (await res.json()) as { status?: unknown; ahead_by?: unknown; behind_by?: unknown; merge_base_commit?: unknown };
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    // GitHub の compare は base...head。ahead_by = head (main) が base (image の commit) より進んだ数、behind_by = main に無い、image 側の commit の数
    const behindBy = num(body.ahead_by), aheadBy = num(body.behind_by);
    if (body.status === "identical") return { status: "current", message: "最新です (image の commit は main と同じです)", local: short, behindBy: 0, aheadBy: 0 };
    if (behindBy > 0) {
      const extra = aheadBy > 0 ? `。このほか main にない commit が ${aheadBy} あります (ブランチや squash merge 前の commit から作った image など)` : "";
      return { status: "behind", message: `この image は main より ${behindBy} commit 古いです。image を作り直してください${extra}`, local: short, behindBy, aheadBy };
    }
    if (aheadBy > 0) return { status: "current", message: `main より先に進んでいます (main にない commit が ${aheadBy} あります)`, local: short, behindBy: 0, aheadBy };
    return { status: "unknown", message: "確かめられません (GitHub の返答を読み取れませんでした)", local: short };
  } catch (e) {
    return { status: "unknown", message: `確かめられません (${describeFetchError(e)})`, local: short };
  }
}

/** fetch の失敗の理由。Node の `fetch failed` だけでは原因が分からないので、`cause` の理由 (ENOTFOUND・証明書・プロキシなど) と、時間切れを添える */
export function describeFetchError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e.name === "TimeoutError" || e.name === "AbortError") return "10 秒以内に GitHub から答えがありませんでした。ネットワーク・プロキシの設定をご確認ください";
  const cause = (e as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const c = cause as { code?: unknown; message?: unknown; hostname?: unknown };
    const detail = [typeof c.code === "string" ? c.code : "", typeof c.hostname === "string" ? c.hostname : "", typeof c.message === "string" && c.message !== e.message ? c.message : ""].filter(Boolean).join(" ");
    if (detail) return `${e.message}: ${detail}。ネットワーク・プロキシの設定をご確認ください`;
  }
  return e.message;
}

/** 本体の、最新の main との差 (利用者が「更新を確認」を押したときだけ)。git の作業コピーは origin へ ls-remote、配布 image は GitHub の API で問い合わせる (どちらも読み取りだけ) */
export async function checkForUpdate(run: GitRunner = runGit, projectRoot = PROJECT_ROOT, fetchFn: FetchFn = (url, init) => fetch(url, init)): Promise<UpdateCheck> {
  try {
    const top = await run(projectRoot, ["rev-parse", "--show-toplevel"]).catch(() => ({ stdout: "", stderr: "", code: 1 }));
    if (top.code !== 0 || path.resolve(top.stdout.trim()) !== path.resolve(projectRoot)) {
      const bi = await readBuildInfo(projectRoot);
      if (bi) return await checkImageUpdate(bi, fetchFn);
      return { status: "unknown", message: "git の作業コピーではないため、更新の確認はできません (配布元をご確認ください)" };
    }
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

/**
 * 更新の確認の結果を、しばらく覚える (GitHub の認証なしの問い合わせは 1 時間に 60 回まで。AI や画面が続けて確認しても使い切らないように)。
 * 覚えるのは確かめられた結果 (current / behind) だけ。失敗 (unknown) はすぐ再試行できるよう覚えない。押したときだけ問い合わせる原則は変わらない
 */
export function memoizeUpdateCheck(check: () => Promise<UpdateCheck>, ttlMs = 60_000, now: () => number = Date.now): () => Promise<UpdateCheck> {
  let last: { at: number; value: Promise<UpdateCheck> } | undefined;
  return () => {
    if (last && now() - last.at < ttlMs) return last.value;
    const value = check();
    const mine = { at: now(), value };
    last = mine;
    void value.then((r) => { if (r.status === "unknown" && last === mine) last = undefined; }, () => { if (last === mine) last = undefined; });
    return value;
  };
}
/** 画面と MCP が使う、覚えつきの更新の確認 */
export const checkForUpdateCached: () => Promise<UpdateCheck> = memoizeUpdateCheck(() => checkForUpdate());

/** MCP (workspace_status / get_project_context) に載せる、この Harmony の要約。ネットワークは使わない。git を何度も呼ばないよう 30 秒だけ覚える */
let summaryCache: { at: number; value: Promise<HarmonySummary> } | undefined;
export interface HarmonySummary { version: string; commit?: string; branch?: string; dirty?: boolean; builtAt?: string; source?: "git" | "image" }
export async function harmonySummary(now = Date.now()): Promise<HarmonySummary> {
  if (summaryCache && now - summaryCache.at < 30_000) return summaryCache.value;
  const value = readVersionInfo(runGit, PROJECT_ROOT, 0).then((v) => ({
    version: v.version, ...(v.commit ? { commit: v.commit } : {}), ...(v.branch ? { branch: v.branch } : {}), ...(v.dirty !== undefined ? { dirty: v.dirty } : {}),
    ...(v.builtAt ? { builtAt: v.builtAt } : {}), ...(v.source ? { source: v.source } : {}),
  }));
  summaryCache = { at: now, value };
  return value;
}
