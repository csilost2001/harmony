/**
 * docStore.ts — 業務フロー (business-flows/<id>.json) と帳票 (reports/<id>.json) の保存 (projectStorage.ts から分離)。
 * 2 つは同じ作りの「文書」なので、読み書き・一覧・競合の検査・参照の追従を共通にしている。
 * 公開する関数は projectStorage.ts が再 export する (利用側の import 先は変わらない)。
 */
import fs from "fs/promises";
import path from "path";
import { DOC_CONFLICT_MARK, DOC_EXISTS_MARK } from "@harmony/shared";
import { logWarn } from "./serverLog.js";
import { assertPathContained } from "./security/idValidator.js";
import { SCHEMAS_DIR, businessFlowsDir, ensureDataDirFromRoot, reportsDir, resolveDataRoot, withFileLock, writeJSON } from "./storageCore.js";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ── 業務フロー・帳票 (business-flows/<id>.json / reports/<id>.json) ─────────────────
// どちらも「ディレクトリの中の 1 ファイル = 1 件」で、保存・一覧・改名追従を同じ仕組みで行う。
// 仕様: docs/spec/business-flow.md / docs/spec/report.md

/** 他で更新されていたため保存しなかった (楽観ロック)。`code` で見分ける */
export class DocConflictError extends Error {
  readonly code = "DOC_CONFLICT";
  constructor(label: string, id: string) {
    super(`${DOC_CONFLICT_MARK} ${label}「${id}」は、開いたあとに他で更新されています。読み直すか、上書きして保存してください`);
  }
}

/** 作成専用の保存で、同じ ID がすでにあった */
export class DocExistsError extends Error {
  readonly code = "DOC_EXISTS";
  constructor(label: string, id: string) {
    super(`${DOC_EXISTS_MARK} ${label}「${id}」はすでにあります (別の場所で先に作られた可能性があります)`);
  }
}

interface DocStore {
  label: string;
  dir: (dataRoot: string) => string;
  schemaFile: string;
  /** 構造として最低限必要な配列 (これが無いものは保存しない) */
  arrays: string[];
}
const BUSINESS_FLOW_STORE: DocStore = { label: "業務フロー", dir: businessFlowsDir, schemaFile: "business-flow.v3.schema.json", arrays: ["lanes", "steps"] };
const REPORT_STORE: DocStore = { label: "帳票", dir: reportsDir, schemaFile: "report.v3.schema.json", arrays: ["sections"] };

/** 保存の条件。expectedUpdatedAt = 開いたときの更新日時 (違えば競合)、createOnly = すでにあれば失敗 (新規作成・複製用) */
export interface DocWriteOpts { expectedUpdatedAt?: string; createOnly?: boolean }

interface DocFile { file: string; id: string; data: Record<string, unknown> }
interface DocList { docs: DocFile[]; unreadable: string[] }

/** JSON を読む。無ければ null、あるのに読めない (壊れている) ときは例外 */
async function readJsonStrict(filePath: string): Promise<unknown | null> {
  let raw: string;
  try { raw = await fs.readFile(filePath, "utf-8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try { return JSON.parse(raw); } catch { throw new Error(`${path.basename(filePath)} を読めません (JSON が壊れています)`); }
}

async function readDoc(store: DocStore, id: string, root: string): Promise<Record<string, unknown> | null> {
  const dataRoot = await resolveDataRoot(root);
  const filePath = path.join(store.dir(dataRoot), `${id}.json`);
  assertPathContained(filePath, dataRoot);
  const data = await readJsonStrict(filePath).catch((e) => { throw new Error(`${store.label}「${id}」: ${(e as Error).message}`); });
  return isRecord(data) ? data : null;
}

/** 全件を読む (ファイル名順)。読めないファイルは黙って捨てず、unreadable として返して警告ログに出す */
async function listDocs(store: DocStore, root: string): Promise<DocList> {
  const out: DocList = { docs: [], unreadable: [] };
  let dir: string;
  let files: string[];
  try {
    dir = store.dir(await resolveDataRoot(root));
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch { return out; }
  for (const f of files) {
    try {
      const d = await readJsonStrict(path.join(dir, f));
      if (isRecord(d)) out.docs.push({ file: f, id: f.replace(/\.json$/, ""), data: d });
      else out.unreadable.push(f);
    } catch {
      out.unreadable.push(f);
    }
  }
  if (out.unreadable.length) logWarn("storage", "doc.list.unreadable", { label: store.label, files: out.unreadable });
  return out;
}

/** 1 件を書く。id はファイル名と一致させ、作成日時は初回を保ち、更新日時を付ける。expectedUpdatedAt があり、保存済みの更新日時と違えば保存しない */
function assertDocShape(store: DocStore, data: unknown): asserts data is Record<string, unknown> {
  if (!isRecord(data) || store.arrays.some((k) => !Array.isArray(data[k]))) {
    throw new Error(`${store.label}は { id, name, ${store.arrays.map((k) => `${k}: []`).join(", ")} } の形で指定してください`);
  }
}

/** 業務フロー・帳票として保存できる形か (保存する前の確認用。形が違えば例外) */
export const assertBusinessFlowShape = (data: unknown): void => assertDocShape(BUSINESS_FLOW_STORE, data);
export const assertReportShape = (data: unknown): void => assertDocShape(REPORT_STORE, data);

async function writeDoc(store: DocStore, id: string, data: unknown, root: string, opts: DocWriteOpts = {}): Promise<Record<string, unknown>> {
  assertDocShape(store, data);
  const dataRoot = await ensureDataDirFromRoot(root);
  const dir = store.dir(dataRoot);
  const filePath = path.join(dir, `${id}.json`);
  assertPathContained(filePath, dataRoot);
  // 確認 → 書き込みの間に別の保存が入らないよう、同じファイルへの保存は 1 本ずつ行う
  return withFileLock(filePath, async () => {
  let prev: unknown = null;
  let broken = false;
  try { prev = await readJsonStrict(filePath); } catch {
    // 壊れているファイルは消さずに退避してから、新しい内容を書く
    await fs.rename(filePath, `${filePath}.broken-${Date.now()}`);
    broken = true;
  }
  if (opts.createOnly && (prev !== null || broken)) throw new DocExistsError(store.label, id);
  if (opts.expectedUpdatedAt !== undefined && isRecord(prev) && prev.updatedAt !== opts.expectedUpdatedAt) throw new DocConflictError(store.label, id);
  const now = new Date().toISOString();
  const { $schema: _ignored, ...rest } = data;
  void _ignored;
  const doc = {
    $schema: path.relative(dir, path.join(SCHEMAS_DIR, "v3", store.schemaFile)).replace(/\\/g, "/"),
    version: 1,
    ...rest,
    id,
    createdAt: isRecord(prev) && typeof prev.createdAt === "string" ? prev.createdAt : (typeof rest.createdAt === "string" ? rest.createdAt : now),
    updatedAt: now,
  };
  await writeJSON(filePath, doc);
  return doc;
  });
}

async function deleteDoc(store: DocStore, id: string, root: string): Promise<boolean> {
  const dataRoot = await resolveDataRoot(root);
  const filePath = path.join(store.dir(dataRoot), `${id}.json`);
  assertPathContained(filePath, dataRoot);
  try { await fs.unlink(filePath); return true; } catch { return false; }
}

/**
 * 全件の文書に変換を当て、変わったものだけ書き戻す。書き戻し先は、読んだファイルそのもの
 * (中の id ではなくファイル名)。1 件の失敗で残りを止めず、失敗は warnings として返す。
 */
async function updateAllDocs(store: DocStore, root: string, change: (doc: Record<string, unknown>) => boolean, dryRun = false): Promise<{ changed: string[]; warnings: string[] }> {
  const res = { changed: [] as string[], warnings: [] as string[] };
  const dataRoot = await resolveDataRoot(root);
  const { docs, unreadable } = await listDocs(store, root);
  for (const f of unreadable) res.warnings.push(`${store.label}のファイル「${f}」が読めないため、参照を更新できませんでした`);
  if (dryRun) {
    // 書き換えずに、書き換わる文書の ID だけを返す (編集中の文書がないかの事前確認用)
    for (const d of docs) if (change(structuredClone(d.data))) res.changed.push(d.id);
    return res;
  }
  for (const d of docs) {
    try {
      const filePath = path.join(store.dir(dataRoot), d.file);
      assertPathContained(filePath, dataRoot);
      // 一覧を読んだあとに保存された内容を巻き戻さないよう、ロックの中で読み直してから変換する
      const hit = await withFileLock(filePath, async () => {
        const latest = await readJsonStrict(filePath);
        if (!isRecord(latest) || !change(latest)) return false;
        await writeJSON(filePath, { ...latest, updatedAt: new Date().toISOString() });
        return true;
      });
      if (hit) res.changed.push(d.id);
    } catch (e) {
      res.warnings.push(`${store.label}「${d.id}」の参照を更新できませんでした: ${(e as Error).message}`);
    }
  }
  return res;
}

export const readBusinessFlow = (flowId: string, root: string) => readDoc(BUSINESS_FLOW_STORE, flowId, root);
export const listBusinessFlowsDetailed = async (root: string) => { const l = await listDocs(BUSINESS_FLOW_STORE, root); return { flows: l.docs.map((d) => d.data), unreadable: l.unreadable }; };
export const listBusinessFlows = async (root: string) => (await listBusinessFlowsDetailed(root)).flows;
export const writeBusinessFlow = (flowId: string, data: unknown, root: string, opts?: DocWriteOpts) => writeDoc(BUSINESS_FLOW_STORE, flowId, data, root, opts);
export const deleteBusinessFlow = (flowId: string, root: string) => deleteDoc(BUSINESS_FLOW_STORE, flowId, root);

export const readReport = (reportId: string, root: string) => readDoc(REPORT_STORE, reportId, root);
export const listReportsDetailed = async (root: string) => { const l = await listDocs(REPORT_STORE, root); return { reports: l.docs.map((d) => d.data), unreadable: l.unreadable }; };
export const listReports = async (root: string) => (await listReportsDetailed(root)).reports;
export const writeReport = (reportId: string, data: unknown, root: string, opts?: DocWriteOpts) => writeDoc(REPORT_STORE, reportId, data, root, opts);
export const deleteReport = (reportId: string, root: string) => deleteDoc(REPORT_STORE, reportId, root);

/** 画面 ID / 処理フロー ID の改名を、全業務フローの工程の参照へ反映する */
export function renameBusinessFlowRefsInProject(kind: "screen" | "processFlow", from: string, to: string, root: string, dryRun = false) {
  const field = kind === "screen" ? "screenRef" : "processFlowRef";
  return updateAllDocs(BUSINESS_FLOW_STORE, root, (flow) => {
    let hit = false;
    for (const s of Array.isArray(flow.steps) ? flow.steps : []) if (isRecord(s) && s[field] === from) { s[field] = to; hit = true; }
    return hit;
  }, dryRun);
}

/** 画面 / 処理フロー / テーブルの ID 改名を、全帳票の出力契機・項目の出どころへ反映する */
export function renameReportRefsInProject(kind: "screen" | "processFlow" | "table", from: string, to: string, root: string, dryRun = false) {
  const tableRe = (s: unknown) => (typeof s === "string" && s.startsWith(`${from}.`) ? `${to}.${s.slice(from.length + 1)}` : s);
  return updateAllDocs(REPORT_STORE, root, (rp) => {
    let hit = false;
    const trig = isRecord(rp.trigger) ? rp.trigger : null;
    if (kind === "screen" && trig?.screenRef === from) { trig.screenRef = to; hit = true; }
    if (kind === "processFlow" && trig?.processFlowRef === from) { trig.processFlowRef = to; hit = true; }
    if (kind === "table") {
      for (const s of Array.isArray(rp.sections) ? rp.sections : []) {
        if (!isRecord(s)) continue;
        const g = tableRe(s.groupBy); if (g !== s.groupBy) { s.groupBy = g; hit = true; }
        for (const f of Array.isArray(s.fields) ? s.fields : []) {
          if (isRecord(f)) { const v = tableRe(f.source); if (v !== f.source) { f.source = v; hit = true; } }
        }
      }
      for (const o of Array.isArray(rp.sort) ? rp.sort : []) {
        if (isRecord(o)) { const v = tableRe(o.field); if (v !== o.field) { o.field = v; hit = true; } }
      }
    }
    return hit;
  }, dryRun);
}

