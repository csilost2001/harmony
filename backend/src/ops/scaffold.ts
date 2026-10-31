/**
 * 開発コンテナの雛形 (generate-code の `ai-skills/generate-code/templates/devcontainer/<組合せ>/`) の更新の記録と、差分の材料 (#1577 第 2 部)。
 *
 * - 雛形の版 = 組合せのフォルダの全ファイル (相対パスの順) の「パス + 中身 (改行は LF)」の SHA-256 の先頭 12 桁。人が版を上げ忘れない
 * - 記録 `<データフォルダ>/scaffold.json` = 雛形を写したときの組合せ・出力先・版・各ファイルの雛形の中身 (backend が雛形から読む。AI に渡させない)
 * - `getScaffoldUpdate` が、記録・いまの雛形・いまのアプリのファイルを突き合わせる。当てるのは AI が、利用者の OK を取って行う (3 方向 / 2 方向で差分を作る)
 *
 * 仕様: docs/spec/integration-ops.md (版と更新)
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isIsoDateTime, isSafeRelPath, type Parsed } from "@harmony/shared";
import type { SchemaIssue } from "../schemaIssues.js";
import { memoizeBySignature } from "../dataSignature.js";
import { findDocsRoot } from "../docsRoot.js";
import { recordAudit } from "./audit.js";
import { cutLines, extractSection, snippetHeading, unifiedDiff, type SectionSlice } from "./lineDiff.js";
import { makeOpsStore } from "./opsFiles.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const TEMPLATES_REL = "ai-skills/generate-code/templates/devcontainer";
/** Harmony 本体のルートにある雛形の置き場所 (固定) */
export const DEFAULT_TEMPLATES_ROOT = path.join(PROJECT_ROOT, TEMPLATES_REL);
/**
 * 雛形の置き場所。資料の置き場 (`HARMONY_DOCS_DIR`。`harmony://skill/...` が読む場所) に従う。呼ぶたびに決める。
 * 資料の置き場が見つからなければ本体のルート。試験では引数の `templatesRoot` で差し替える
 */
export function defaultTemplatesRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(findDocsRoot(env) ?? PROJECT_ROOT, TEMPLATES_REL);
}

/** generate-code の表 (backend.framework × frontend.library → 雛形のフォルダ) と同じ 4 つ */
export const SCAFFOLD_COMBOS = ["spring-boot-thymeleaf", "spring-boot-nextjs", "nestjs-thymeleaf", "nestjs-nextjs"] as const;
export type ScaffoldCombo = (typeof SCAFFOLD_COMBOS)[number];
const isCombo = (v: unknown): v is ScaffoldCombo => typeof v === "string" && (SCAFFOLD_COMBOS as readonly string[]).includes(v);

export type ScaffoldKind = "file" | "section";
/** 中身を返すときの、1 ファイルの上限 (これを超える分は切る) */
export const MAX_SCAFFOLD_CONTENT = 200 * 1024;
const MAX_RECORD_CONTENT = 1024 * 1024;
const MAX_FILES = 50;
const VERSION_RE = /^[0-9a-f]{12}$/;
/** ルートの `.devcontainer/compose.yml` が Harmony の配布 image を使っているかの目印 */
export const HARMONY_IMAGE = "ghcr.io/csilost2001/harmony";
/** `image:` の行 (環境変数の既定値 `${HARMONY_IMAGE:-…}` を含む) が配布 image を指しているか。コメント・別名の image (`harmony-xxx`) は除く */
const HARMONY_IMAGE_LINE = new RegExp(`^\\s*image:\\s*["']?(?:\\$\\{[A-Za-z_][A-Za-z0-9_]*:?-)?${HARMONY_IMAGE.replace(/[.]/g, "\\.")}(?=[:@"'}\\s]|$)`, "m");

export interface ScaffoldFileRecord { template: string; path: string; kind: ScaffoldKind; content?: string; skipped?: true }
export interface ScaffoldRecord { version: 1; combo: ScaffoldCombo; outDir: string; templateVersion: string; recordedAt: string; files: ScaffoldFileRecord[] }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const lf = (s: string): string => s.replace(/\r\n/g, "\n");
const isOutDir = (v: unknown): v is string => v === "." || isSafeRelPath(v);

export function parseScaffold(raw: unknown): Parsed<ScaffoldRecord | null> {
  if (raw === undefined || raw === null) return { value: null, problems: [] };
  if (!isRecord(raw) || !isCombo(raw.combo) || !isOutDir(raw.outDir) || typeof raw.templateVersion !== "string" || !VERSION_RE.test(raw.templateVersion) || !isIsoDateTime(raw.recordedAt) || !Array.isArray(raw.files)) {
    return { value: null, problems: ["scaffold.json の形が正しくありません (combo・outDir・templateVersion・recordedAt・files)"] };
  }
  const problems: string[] = [];
  const files: ScaffoldFileRecord[] = [];
  if (raw.files.length > MAX_FILES) problems.push(`scaffold.json のファイルが ${MAX_FILES} 件を超えています。${MAX_FILES + 1} 件目以降 (${raw.files.length - MAX_FILES} 件) は読みません`);
  raw.files.slice(0, MAX_FILES).forEach((f, i) => {
    if (!isRecord(f) || !isSafeRelPath(f.template) || !isSafeRelPath(f.path) || (f.kind !== "file" && f.kind !== "section")
      || (f.content !== undefined && (typeof f.content !== "string" || f.content.length > MAX_RECORD_CONTENT))) {
      problems.push(`scaffold.json の ${i + 1} 件目のファイルが読めません`);
      return;
    }
    if (files.some((x) => x.template === f.template)) { problems.push(`scaffold.json の「${f.template}」が重複しています`); return; }
    files.push({ template: f.template, path: f.path, kind: f.kind, ...(f.skipped === true ? { skipped: true as const } : typeof f.content === "string" ? { content: f.content } : {}) });
  });
  return { value: { version: 1, combo: raw.combo, outDir: raw.outDir, templateVersion: raw.templateVersion, recordedAt: raw.recordedAt, files }, problems };
}

export const scaffoldStore = makeOpsStore<ScaffoldRecord | null>({ file: "scaffold.json", scope: "data", parse: parseScaffold, empty: () => null });

// ── 雛形 ──────────────────────────────────────────────────────────────

export interface TemplateFile { template: string; path: string; kind: ScaffoldKind; content: string }
export interface TemplateSet { combo: ScaffoldCombo; version: string; files: TemplateFile[] }

/** 雛形のファイルの行き先 (ワークスペースのルートからの相対パス)。ルートに置くもの / 出力先に置くもの / README の節 */
const ROOT_FILES = new Set([".devcontainer/devcontainer.json", ".devcontainer/compose.yml", ".mcp.json", ".tmp/.gitignore"]);
const README_SNIPPET = "README.snippet.md";

/** 雛形のファイル (組合せのフォルダの中) の、行き先とその種類。表にないファイルは、出力先に同じ相対パスで置く扱い */
export function destinationOf(template: string, outDir: string): { path: string; kind: ScaffoldKind } {
  const inOut = (rel: string) => (outDir === "." ? rel : `${outDir}/${rel}`);
  if (ROOT_FILES.has(template)) return { path: template, kind: "file" };
  if (template === README_SNIPPET) return { path: inOut("README.md"), kind: "section" };
  return { path: inOut(template), kind: "file" };
}

async function listFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await listFiles(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** 雛形の版: 全ファイルを相対パスの順に並べ、パスと中身 (LF) を SHA-256 にかけた先頭 12 桁 */
export function templateVersionOf(files: ReadonlyArray<{ template: string; content: string }>): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.template < b.template ? -1 : a.template > b.template ? 1 : 0))) h.update(`${f.template}\0${lf(f.content)}\0`);
  return h.digest("hex").slice(0, 12);
}

/** 組合せの雛形を読む (無い・読めないときは null)。行き先 (path) は outDir を入れて決める */
export async function loadTemplate(combo: ScaffoldCombo, outDir: string, templatesRoot = defaultTemplatesRoot()): Promise<TemplateSet | null> {
  const dir = path.join(templatesRoot, combo);
  try {
    const names = (await listFiles(dir)).sort();
    if (!names.length) return null;
    const files: TemplateFile[] = [];
    for (const template of names) files.push({ template, ...destinationOf(template, outDir), content: lf(await fs.readFile(path.join(dir, template), "utf-8")) });
    return { combo, version: templateVersionOf(files), files };
  } catch { return null; }
}

/** harmony.json の techStack (backend.framework × frontend.library) から、雛形の組合せ。決まらなければ null */
export async function comboFromTechStack(root: string): Promise<ScaffoldCombo | null> {
  try {
    const hj: unknown = JSON.parse(await fs.readFile(path.join(root, "harmony.json"), "utf-8"));
    const ts = isRecord(hj) && isRecord(hj.techStack) ? hj.techStack : null;
    const fw = isRecord(ts?.backend) ? String(ts.backend.framework ?? "").trim().toLowerCase() : "";
    const lib = isRecord(ts?.frontend) ? String(ts.frontend.library ?? "").trim().toLowerCase() : "";
    const back = fw === "spring-boot" || fw === "nestjs" ? fw : null;
    const front = lib === "thymeleaf" ? "thymeleaf" : lib === "react" ? "nextjs" : null;
    return back && front ? (`${back}-${front}` as ScaffoldCombo) : null;
  } catch { return null; }
}

/** ルートの `.devcontainer/compose.yml` が Harmony の配布 image を使っているか (記録の無いアプリに知らせる条件) */
export async function usesHarmonyImage(root: string): Promise<boolean> {
  try { return HARMONY_IMAGE_LINE.test(await fs.readFile(path.join(root, ".devcontainer/compose.yml"), "utf-8")); } catch { return false; }
}

// ── 状態 ──────────────────────────────────────────────────────────────

export type ScaffoldStatus = "current" | "outdated" | "no-record" | "not-applicable";
/** not-applicable の理由の種類 (文言でなく、これで分岐する) */
export type ScaffoldReasonCode = "tech-stack-undecided" | "no-scaffold-record" | "template-missing" | "image-not-used";
export interface ScaffoldSummary { status: ScaffoldStatus; combo?: ScaffoldCombo; recordedVersion?: string; currentVersion?: string; outDir?: string; reason?: string; reasonCode?: ScaffoldReasonCode }

interface Resolved { summary: ScaffoldSummary; record: ScaffoldRecord | null; template: TemplateSet | null; problems: string[] }

async function resolve(root: string, templatesRoot: string): Promise<Resolved> {
  const { value: record, problems } = await scaffoldStore.read(root);
  const combo = record?.combo ?? await comboFromTechStack(root);
  const outDir = record?.outDir ?? ".";
  if (!combo) {
    const harmony = await usesHarmonyImage(root);
    return { summary: harmony
      ? { status: "not-applicable", reasonCode: "tech-stack-undecided", reason: "組合せが決まりません。harmony.json の techStack (backend.framework と frontend.library) を決めてください" }
      : { status: "not-applicable", reasonCode: "no-scaffold-record", reason: "このワークスペースには、開発コンテナの雛形の記録がありません" }, record, template: null, problems };
  }
  const template = await loadTemplate(combo, outDir, templatesRoot);
  if (!template) return { summary: { status: "not-applicable", combo, reasonCode: "template-missing", reason: `雛形 (${combo}) が見つかりません。Harmony 本体が古いか、壊れている可能性があります` }, record, template: null, problems };
  const base = { combo, outDir, currentVersion: template.version };
  if (record) return { summary: { ...base, status: record.templateVersion === template.version ? "current" : "outdated", recordedVersion: record.templateVersion }, record, template, problems };
  if (await usesHarmonyImage(root)) return { summary: { ...base, status: "no-record" }, record, template, problems };
  return { summary: { ...base, status: "not-applicable", reasonCode: "image-not-used", reason: "このワークスペースには、開発コンテナの雛形の記録も、Harmony の image を使う .devcontainer/compose.yml もありません" }, record, template: null, problems };
}

/** 状態の要約 (中身は入れない)。designer__get_project_context と画面・点検が使う */
export async function scaffoldSummary(root: string, templatesRoot = defaultTemplatesRoot()): Promise<ScaffoldSummary & { problems?: string[] }> {
  const r = await resolve(root, templatesRoot);
  return { ...r.summary, ...(r.problems.length ? { problems: r.problems } : {}) };
}

/** 状態の要約から、設計の要確認 (info)。理由の文でなく status / reasonCode で分ける */
export function issuesOfSummary(s: ScaffoldSummary): SchemaIssue[] {
  const section = "開発コンテナの雛形";
  if (s.status === "outdated") return [{ severity: "info", section, message: `開発コンテナの雛形 (${s.combo}) が新しくなっています (記録 ${s.recordedVersion} → いま ${s.currentVersion})。designer__get_scaffold_update で差分を見て、利用者の OK で取り込めます` }];
  if (s.status === "no-record") return [{ severity: "info", section, message: `開発コンテナの雛形の記録がありません (雛形 ${s.combo}、いまの版 ${s.currentVersion})。designer__get_scaffold_update で、いまの雛形と比べて取り込めます` }];
  if (s.status === "not-applicable" && s.reasonCode === "tech-stack-undecided") return [{ severity: "info", section, message: `開発コンテナの雛形の記録がありません。${s.reason}` }];
  return [];
}
/** 設計の要確認 (info) の中身 (毎回、雛形を読んで版を計算する) */
async function computeScaffoldIssues(root: string, templatesRoot: string): Promise<SchemaIssue[]> {
  try { return issuesOfSummary(await scaffoldSummary(root, templatesRoot)); } catch { return []; /* 点検は、雛形が読めなくても止めない */ }
}
/** 点検のたびに雛形 7 ファイルと compose を読んで SHA-256 を取らないよう、設計のデータとルートの compose.yml が変わらないあいだは前の結果を使う (雛形そのものは Harmony の更新まで変わらない) */
const composeSignature = async (root: string): Promise<string> => { const st = await fs.stat(path.join(root, ".devcontainer/compose.yml")); return `${st.size}:${Math.round(st.mtimeMs)}`; };
const scaffoldIssuesMemo = memoizeBySignature((root: string) => computeScaffoldIssues(root, defaultTemplatesRoot()), composeSignature);

/** 設計の要確認 (info) に足す。該当しないワークスペースには何も出さない。雛形の置き場を指定したとき (試験) は覚えない */
export async function collectScaffoldIssues(root: string, templatesRoot?: string): Promise<SchemaIssue[]> {
  return templatesRoot ? computeScaffoldIssues(root, templatesRoot) : scaffoldIssuesMemo(root);
}

// ── 記録 ──────────────────────────────────────────────────────────────

export interface RecordScaffoldInput { combo?: unknown; outDir?: unknown; skipped?: unknown }

/** いまの雛形の版で、記録を書き直す。写したあと (generate-code)・更新を当てたあと (AI) に呼ぶ */
export async function recordScaffold(root: string, input: RecordScaffoldInput, actor = "AI", templatesRoot = defaultTemplatesRoot()): Promise<{ combo: ScaffoldCombo; outDir: string; templateVersion: string; recorded: number; skipped: string[] }> {
  const prev = (await scaffoldStore.read(root)).value;
  if (input.combo !== undefined && !isCombo(input.combo)) throw new Error(`combo は ${SCAFFOLD_COMBOS.join(" / ")} のどれかです`);
  const combo = (input.combo as ScaffoldCombo | undefined) ?? prev?.combo ?? await comboFromTechStack(root);
  if (!combo) throw new Error("雛形の組合せを決められません。combo を指定するか、harmony.json の techStack (backend.framework と frontend.library) を決めてください");
  if (input.outDir !== undefined && !isOutDir(input.outDir)) throw new Error(`outDir が正しくありません (ワークスペースからの安全な相対パスか "." で書いてください): ${String(input.outDir)}`);
  const outDir = (input.outDir as string | undefined) ?? prev?.outDir ?? ".";
  const tpl = await loadTemplate(combo, outDir, templatesRoot);
  if (!tpl) throw new Error(`雛形 (${combo}) が見つかりません`);
  const known = new Set(tpl.files.map((f) => f.template));
  let skipped: string[];
  if (input.skipped === undefined) skipped = (prev?.files ?? []).filter((f) => f.skipped && known.has(f.template)).map((f) => f.template); // 省略は、前回飛ばしたままにする
  else {
    if (!Array.isArray(input.skipped) || input.skipped.some((s) => typeof s !== "string")) throw new Error("skipped は、雛形のファイルのパスの配列です");
    const bad = (input.skipped as string[]).filter((s) => !known.has(s));
    if (bad.length) throw new Error(`skipped に、雛形にないパスがあります: ${bad.join(", ")} (雛形のパス: ${[...known].join(", ")})`);
    skipped = [...new Set(input.skipped as string[])];
  }
  const files: ScaffoldFileRecord[] = tpl.files.map((f) => ({ template: f.template, path: f.path, kind: f.kind, ...(skipped.includes(f.template) ? { skipped: true as const } : { content: f.content }) }));
  const record: ScaffoldRecord = { version: 1, combo, outDir, templateVersion: tpl.version, recordedAt: new Date().toISOString(), files };
  await scaffoldStore.update(root, () => record, { discardUnreadable: true });
  void recordAudit(root, { actor, action: "開発コンテナの雛形の記録を残した", target: combo, detail: `版 ${tpl.version}`, via: "ai" });
  return { combo, outDir, templateVersion: tpl.version, recorded: files.length - skipped.length, skipped };
}

// ── 差分の材料 ────────────────────────────────────────────────────────

export type ScaffoldFileState = "unchanged" | "template-changed" | "new-in-template" | "removed-from-template";
export interface ScaffoldFileView {
  template: string; path: string; kind: ScaffoldKind; state: ScaffoldFileState;
  /** 写したときの雛形の中身。記録が無い・飛ばしたファイルは無い (2 方向)。変わったファイルだけ */
  base?: string;
  /** いまのアプリのファイル (README の節は README.md 全体)。無ければ null。変わったファイルだけ */
  app?: string | null;
  /** README の節 (kind が section のときだけ): README から切り出した、いまの節 (snippet の最初の見出しから、同じか上のレベルの次の見出しの前まで。README の終わりまで続くこともある)。README に節が無ければ null。差し替えるのはこの範囲だけ */
  appSection?: string | null;
  /** README の節の見出しの行 (README にある行。節が無ければ雛形の見出し) */
  sectionHeading?: string | null;
  /** README の中の節の位置 (1 始まり、両端を含む行番号)。節が無ければ null */
  appSectionRange?: { startLine: number; endLine: number } | null;
  /** 人に見せる差分 (unified diff): いまのアプリ (節なら appSection) → 新しい雛形。同じなら空文字。変わったファイルだけ。自分で差分を作らず、これを見せる */
  diff?: string;
  /** 雛形の変更 (写したとき base → 新しい雛形)。base があるときだけ */
  templateDiff?: string;
  /** 利用者の手入れ (写したとき base → いまのアプリ・節なら appSection)。base があり、アプリにファイルがあるときだけ */
  appChanges?: string;
  /** 行数が多すぎて (どちらかが 3000 行を超える)、差分を作らなかったものがある。そのファイルは app / latest / base を自分で比べる */
  diffTooLarge?: true;
  /** 差分が 200KB を超えたので、行の境界で切った */
  diffTruncated?: true;
  /** いまの雛形の中身。雛形から無くなったファイルは null。変わったファイルだけ */
  latest?: string | null;
  /** 利用者が手を入れたか。写したときの中身 (base) と違えば true。base が無い (2 方向) ときは、いまの雛形と違えば true ではなく null (不明) */
  appEdited: boolean | null;
  /** 200KB で切ったか */
  truncated?: boolean;
}
export interface ScaffoldUpdate extends ScaffoldSummary { recordedAt?: string; files: ScaffoldFileView[]; guide: string[]; problems: string[] }

const GUIDE = [
  "1. files のうち state が unchanged でないものが、当てる対象です。latest が新しい雛形、app がいまのアプリのファイル、base が写したときの雛形です。人に見せる差分は diff (いまのアプリ → 新しい雛形)、base があれば templateDiff (雛形の変更)・appChanges (利用者の手入れ) が unified diff で付きます。自分で差分を作らず、これを見せてください (diffTooLarge のファイルだけ自分で比べます)。",
  "2. base があるファイルは 3 方向で比べます: base→latest が雛形の変更、base→app が利用者の手入れ。雛形の変更を取り込み、利用者が手を入れた箇所は残します。",
  "3. base が無いファイル (記録が無い・飛ばしたファイル) は 2 方向で比べます: app と latest の差を、利用者に見せて 1 つずつ選んでもらいます。appEdited が null のとき、手入れかどうかは分かりません。",
  "4. 残すもの: Harmony の image の版 (compose.yml の image: の指定)・利用者が足した service・ポート・環境変数・自分で書いた設定。雛形が変えた箇所だけを足します。",
  "5. 書く前に、ファイルごとの差分を利用者に見せて OK を取ります。OK が無いファイルは書きません。kind が section の README は、appSection (README から切り出した節。appSectionRange の行) の範囲だけを latest の節で差し替えます (README の他の部分は触りません)。appSection が null なら README に節が無いので、latest の節を README に足します。",
  "6. 当てたら designer__record_scaffold を呼びます。当てなかったファイル (利用者が見送った・既存のまま残した) は必ず skipped に渡してください。渡さないと、そのファイルの「写したときの中身」が最新の雛形に置き換わり、次の更新で利用者の手入れと雛形の変更を取り違えます。これで記録の版が最新になり、お知らせが消えます。",
  "7. .devcontainer/ のファイルを変えたときは、利用者に VS Code の「Dev Containers: Rebuild Container」を頼みます (変更は作り直すまで効きません)。",
];

async function readApp(root: string, rel: string): Promise<string | null> {
  try {
    const abs = path.join(root, rel);
    const real = await fs.realpath(abs);
    const base = await fs.realpath(root);
    if (real !== base && !real.startsWith(base + path.sep)) return null; // ワークスペースの外を指す symlink は読まない
    return lf(await fs.readFile(real, "utf-8"));
  } catch { return null; }
}

/** 上限のバイト数で切る。日本語などの途中で切らないよう、切り口は文字の境界に寄せる (UTF-8 の後続バイトの手前まで戻る) */
export function cutAtCharBoundary(s: string, max: number): string {
  const buf = Buffer.from(s);
  if (buf.length <= max) return s;
  let end = max;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8");
}
const cut = (s: string | null | undefined): { v: string | null | undefined; truncated: boolean } =>
  typeof s === "string" && Buffer.byteLength(s) > MAX_SCAFFOLD_CONTENT ? { v: cutAtCharBoundary(s, MAX_SCAFFOLD_CONTENT), truncated: true } : { v: s, truncated: false };

/** README の節の等しさ: 切り出した節と snippet が、空白の違いを除いて等しいか */
const sameSection = (section: string, snippet: string): boolean => section.replace(/\s+/g, " ").trim() === snippet.replace(/\s+/g, " ").trim();

/** README の節は、README.md の中に snippet が (空白の違いを除いて) そのまま入っているかで見る */
const sectionHas = (app: string, snippet: string): boolean => app.replace(/\s+/g, " ").includes(snippet.replace(/\s+/g, " ").trim());

/** README から節を切り出す。見出しは、いまの雛形 (latest) の見出しで探し、無ければ写したとき (base) の見出し (見出しの文を変えた雛形でも見つける) */
const findSection = (readme: string, latest: string | null | undefined, base: string | undefined): SectionSlice | null =>
  (latest ? extractSection(readme, latest) : null) ?? (base ? extractSection(readme, base) : null);

/** 節の比べるときは、末尾の空行・空白を除いて 1 つの改行で終える (節は README の中で後ろに空行が続くため) */
const eolNorm = (s: string): string => { const t = s.replace(/\s+$/, ""); return t ? `${t}\n` : ""; };

/** 人に見せる差分を view に足す。節は appPart (切り出した節) と、末尾をそろえた雛形・base で比べる */
function addDiffs(view: ScaffoldFileView, p: string, kind: ScaffoldKind, latest: string | null, base: string | undefined, appPart: string | null, fileExists: boolean): void {
  const n = (v: string | null | undefined): string => (v == null ? "" : kind === "section" ? eolNorm(v) : v);
  let tooLarge = false, truncated = false;
  const make = (a: string, b: string): string | undefined => {
    const d = unifiedDiff(a, b, p);
    if (d.tooLarge) { tooLarge = true; return undefined; }
    const c = cutLines(d.diff, MAX_SCAFFOLD_CONTENT);
    if (c.truncated) truncated = true;
    return c.text;
  };
  const diff = make(n(appPart), n(latest));
  if (diff !== undefined) view.diff = diff;
  if (base !== undefined) {
    const t = make(n(base), n(latest));
    if (t !== undefined) view.templateDiff = t;
    if (fileExists) { const c = make(n(base), n(appPart)); if (c !== undefined) view.appChanges = c; }
  }
  if (tooLarge) view.diffTooLarge = true;
  if (truncated) view.diffTruncated = true;
}

/** README に、snippet の見出し (最初の空でない行) の行があるか。無ければ「節を足す」(new-in-template) */
const hasSectionHeading = (app: string, snippet: string): boolean => {
  const heading = snippet.split("\n").map((l) => l.trim()).find(Boolean);
  return !heading || app.split("\n").some((l) => l.trim() === heading);
};

export async function getScaffoldUpdate(root: string, templatesRoot = defaultTemplatesRoot()): Promise<ScaffoldUpdate> {
  const r = await resolve(root, templatesRoot);
  const out: ScaffoldUpdate = { ...r.summary, ...(r.record ? { recordedAt: r.record.recordedAt } : {}), files: [], guide: r.summary.status === "not-applicable" ? [] : GUIDE, problems: r.problems };
  if (!r.template) return out;
  const noRecord = !r.record;
  const sameVersion = r.summary.status === "current";
  const recorded = new Map((r.record?.files ?? []).map((f) => [f.template, f]));
  const views: ScaffoldFileView[] = [];

  const push = async (template: string, p: string, kind: ScaffoldKind, latest: string | null, rec: ScaffoldFileRecord | undefined, state: ScaffoldFileState) => {
    const app = await readApp(root, p);
    const base = rec && !rec.skipped && typeof rec.content === "string" ? lf(rec.content) : undefined;
    // README の節は、README 全体でなく、切り出した節で比べる (節の見出しが無い snippet は、README 全体で見る)
    const sec = kind === "section" && app !== null ? findSection(app, latest, base) : null;
    const appPart = kind === "section" ? (sec ? sec.text : null) : app;
    const edited = (): boolean | null => {
      if (app === null) return base !== undefined ? false : null; // アプリに無い: 手入れではない
      if (base === undefined) return null;
      if (kind !== "section") return app !== base;
      // 節は、切り出した節との等しさ (空白を畳む) で見る。利用者が節に行を足したら手入れ (appChanges にも出る)。見出しの無い snippet だけ README 全体で見る
      if (sec) return !sameSection(sec.text, base);
      return snippetHeading(base) ? true : !sectionHas(app, base);
    };
    const view: ScaffoldFileView = { template, path: p, kind, state, appEdited: edited() };
    if (state !== "unchanged") {
      const b = cut(base), a = cut(app), l = cut(latest);
      if (b.v !== undefined) view.base = b.v as string;
      view.app = a.v ?? null;
      view.latest = l.v ?? null;
      if (b.truncated || a.truncated || l.truncated) view.truncated = true;
      if (kind === "section") {
        view.appSection = sec ? sec.text : null;
        view.sectionHeading = sec ? sec.heading : (snippetHeading(latest ?? base ?? "")?.line ?? null);
        view.appSectionRange = sec ? { startLine: sec.startLine, endLine: sec.endLine } : null;
      }
      addDiffs(view, p, kind, latest, base, appPart, app !== null);
    }
    views.push(view);
  };

  for (const f of r.template.files) {
    if (noRecord) {
      // 記録が無いので、アプリといまの雛形の違いだけを見る (2 方向)
      const app = await readApp(root, f.path);
      const secNow = f.kind === "section" && app !== null ? findSection(app, f.content, undefined) : null;
      const same = app !== null && (f.kind === "section" ? (secNow ? sameSection(secNow.text, f.content) : !snippetHeading(f.content) && sectionHas(app, f.content)) : app === f.content);
      // アプリにファイルが無い・README に節が無い (足すだけ) は new-in-template、中身が違うのは template-changed
      const missing = app === null || (f.kind === "section" && !hasSectionHeading(app, f.content));
      await push(f.template, f.path, f.kind, f.content, undefined, same ? "unchanged" : missing ? "new-in-template" : "template-changed");
      continue;
    }
    const rec = recorded.get(f.template);
    if (!rec) { await push(f.template, f.path, f.kind, f.content, undefined, "new-in-template"); continue; }
    const changed = !sameVersion && (rec.skipped || typeof rec.content !== "string" || lf(rec.content) !== f.content);
    await push(f.template, f.path, f.kind, f.content, rec, changed ? "template-changed" : "unchanged");
  }
  if (r.record) {
    const inTemplate = new Set(r.template.files.map((f) => f.template));
    for (const rec of r.record.files) if (!inTemplate.has(rec.template)) await push(rec.template, rec.path, rec.kind, null, rec, "removed-from-template");
  }
  out.files = views;
  return out;
}
