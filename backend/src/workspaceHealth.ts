/**
 * ワークスペースのファイルの健全性の検査と、保守の操作 (すべて、書き込むのは利用者・AI の明示的な操作のときだけ)。
 *
 * - scanWorkspaceHealth   読めない (壊れている) ファイル・大きすぎるファイル・ファイル名と id の食い違い・
 *                         一覧 (harmony.json) にあるのにファイルが無い項目・uuid が未保存の設計を、要確認として返す (読むだけ)
 * - repairRegistry        一覧とファイルの食い違いを直す (一覧に載っていないファイルを足す / ファイルが無い項目を外す)。既定は予行
 * - persistDerivedUuids   uuid が未保存の設計に、読み出しで補っている値を書いて固定する。既定は予行
 *
 * 仕様: docs/spec/workspace-health.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  actionsDir, deriveStableUuid, entityDirOf, isLegacyGrapesScreen, listExistingEntityIds, listScreenIdsIncludingLegacy, projectSaltFor, readProject, resolveDataRoot,
  writeJsonFile, writeProject, type TopLevelEntityKind,
} from "./projectStorage.js";
import { mergeUnregisteredEntities } from "./registryMerge.js";
import { memoizeBySignature } from "./dataSignature.js";
import { createFileMemo } from "./fileMemo.js";

/** これを超える JSON は、読み込みを避けて「大きすぎる」として知らせる */
export const MAX_JSON_BYTES = 20 * 1024 * 1024;

export type HealthCode = "unreadable-file" | "unreadable-json" | "too-large" | "not-object" | "id-mismatch" | "registry-missing-file" | "registry-unregistered" | "registry-legacy-keys" | "uuid-unsaved";

export interface HealthIssue {
  /** 画面の出し分け (保守ボタンなど) に使う種類。文言を変えても動くよう、文言では判定しない */
  code: HealthCode;
  severity: "error" | "warning" | "info";
  section: string;
  message: string;
  ref?: { kind: "screen" | "table" | "processFlow"; id: string };
  /** 設計の内容の問題ではなく、保守の操作の案内 (設計書・check_design の要確認には出さない。ダッシュボードの保守ボタンの出し分けに使う) */
  maintenance?: true;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * harmony.json の最上位にあってはいけない、旧形式の項目。v3 の harmony.json は、最上位に使える項目が決まっている
 * (schemas/v3/harmony.v3.schema.json)。旧形式の tool が `tables` / `updatedAt` などを足すと、画面がワークスペースを開けなくなる (#1568)。
 * 一覧は entities.<種類>、更新時刻は meta.updatedAt が正しい置き場。ここに挙げた名前だけを「取り除く候補」にする
 * (綴りの違いなど、ほかの未知の項目は、利用者の書いたものかもしれないので勝手に消さない)。
 */
export const LEGACY_PROJECT_KEYS = ["tables", "screens", "processFlows", "edges", "updatedAt"] as const;

/** v3 の harmony.json の最上位に使える項目 (スキーマの properties と同じ) */
const V3_PROJECT_KEYS = new Set(["$schema", "schemaVersion", "dataDir", "meta", "extensionsApplied", "entities", "authoring", "techStack"]);

/** harmony.json の最上位にある、旧形式の項目の名前 (v3 で使える項目は含めない) */
export function findLegacyProjectKeys(project: unknown): string[] {
  if (!isRecord(project)) return [];
  return LEGACY_PROJECT_KEYS.filter((k) => !V3_PROJECT_KEYS.has(k) && k in project);
}

const KINDS: Array<{ kind: TopLevelEntityKind; label: string }> = [
  { kind: "screen", label: "画面" }, { kind: "table", label: "テーブル" }, { kind: "processFlow", label: "処理フロー" },
  { kind: "sequence", label: "シーケンス" }, { kind: "view", label: "ビュー" }, { kind: "viewDefinition", label: "ビュー定義" },
  { kind: "pageLayout", label: "ページレイアウト" },
];
/**
 * 種類を持たないが、読めることを確かめるフォルダ。
 * 業務フロー (business-flows) と帳票 (reports) は、設計書の入力 (designInput) が「読めないもの」として別に知らせるので、ここでは見ない (二重に数えない)。
 */
const EXTRA_DIRS = ["screen-items", "conventions", "catalogs", "extensions"];

/**
 * JSON の文法の誤りが最初に出る位置 (文字の位置) を探す。JSON.parse の例外は、環境によって位置を含まないため、自前で走査する。
 * 正しい JSON なら null。
 */
export function findJsonErrorOffset(raw: string): number | null {
  let i = 0;
  const n = raw.length;
  const ws = (): void => { while (i < n && " \t\r\n".includes(raw[i])) i++; };
  const fail = (): never => { throw i; };
  const lit = (word: string): void => { if (raw.startsWith(word, i)) i += word.length; else fail(); };
  const str = (): void => {
    i++; // 開きの "
    while (i < n) {
      const c = raw[i];
      if (c === '"') { i++; return; }
      if (c === "\\") {
        const e = raw[i + 1];
        if (e === "u") { if (!/^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) { i += 2; fail(); } i += 6; continue; }
        if (e === undefined || !'"\\/bfnrt'.includes(e)) { i += 1; fail(); }
        i += 2; continue;
      }
      if (c < " ") fail();
      i++;
    }
    fail();
  };
  const value = (): void => {
    ws();
    const c = raw[i];
    if (c === "{") {
      i++; ws();
      if (raw[i] === "}") { i++; return; }
      for (;;) {
        ws(); if (raw[i] !== '"') fail(); str(); ws();
        if (raw[i] !== ":") fail(); i++; value(); ws();
        if (raw[i] === ",") { i++; continue; }
        if (raw[i] === "}") { i++; return; }
        fail();
      }
    } else if (c === "[") {
      i++; ws();
      if (raw[i] === "]") { i++; return; }
      for (;;) {
        value(); ws();
        if (raw[i] === ",") { i++; continue; }
        if (raw[i] === "]") { i++; return; }
        fail();
      }
    } else if (c === '"') str();
    else if (c === "t") lit("true");
    else if (c === "f") lit("false");
    else if (c === "n") lit("null");
    else {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(raw.slice(i));
      if (!m) fail();
      i += m![0].length;
    }
  };
  try {
    ws(); value(); ws();
    if (i < n) return i;
    return null;
  } catch (e) {
    return typeof e === "number" ? e : 0;
  }
}

/** 壊れた JSON の誤りの場所を、「n 行目 m 桁目」にする */
export function describeJsonError(raw: string, _err?: unknown): string {
  const off = findJsonErrorOffset(raw);
  if (off === null) return "JSON として読めません";
  const before = raw.slice(0, Math.min(off, raw.length));
  const line = before.split("\n").length;
  const col = off - (before.lastIndexOf("\n") + 1) + 1;
  return `JSON として読めません (${line} 行目 ${col} 桁目付近)`;
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try { return (await fs.readdir(dir)).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort(); } catch { return []; }
}

interface Probe { file: string; label: string; ref?: HealthIssue["ref"]; kind?: TopLevelEntityKind }

interface ProbeResult { issues: HealthIssue[]; uuidless: boolean }
/** ファイルごとの検査結果 (ファイルの状態が変わらないあいだ使い回す。1 件の保存で、全件を読み直さない) */
const probeMemo = createFileMemo<ProbeResult>();

const probeFile = (dir: string, p: Probe, dataRoot: string): Promise<ProbeResult> => probeMemo.get(path.join(dir, p.file), () => probeFileUncached(dir, p, dataRoot));

async function probeFileUncached(dir: string, p: Probe, dataRoot: string): Promise<ProbeResult> {
  const issues: HealthIssue[] = [];
  const full = path.join(dir, p.file);
  const rel = path.relative(dataRoot, full).split(path.sep).join("/");
  const section = `${p.label} ${rel}`;
  let st;
  try { st = await fs.stat(full); } catch { return { issues, uuidless: false }; }
  if (st.size > MAX_JSON_BYTES) {
    issues.push({ code: "too-large", severity: "warning", section, message: `ファイルが大きすぎます (${Math.round(st.size / 1024 / 1024)} MB。上限 ${MAX_JSON_BYTES / 1024 / 1024} MB)。読み込みを避けているため、一覧・検査に含まれません。分割するか、不要なデータを減らしてください` });
    return { issues, uuidless: false };
  }
  let raw: string;
  try { raw = await fs.readFile(full, "utf-8"); } catch (e) {
    issues.push({ code: "unreadable-file", severity: "error", section, message: `ファイルを読めません: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}` });
    return { issues, uuidless: false };
  }
  let data: unknown;
  try { data = JSON.parse(raw); } catch (e) {
    issues.push({ code: "unreadable-json", severity: "error", section, message: `${describeJsonError(raw, e)}。このままでは一覧・検査・設計書に含まれません。直すか、バックアップ (.harmony-backups) から戻してください` });
    return { issues, uuidless: false };
  }
  if (!p.kind || p.file.endsWith(".design.json")) return { issues, uuidless: false };
  // 旧形式 (GrapesJS) の画面は、保存するまで旧形式のまま (id・uuid を持たない)。読み出しでは変換して扱うので、ここでは検査しない
  if (p.kind === "screen" && isLegacyGrapesScreen(data)) return { issues, uuidless: false };
  if (!isRecord(data)) {
    issues.push({ code: "not-object", severity: "error", section, message: "ファイルの中身がオブジェクトではありません" });
    return { issues, uuidless: false };
  }
  const holder = p.kind === "processFlow" ? (isRecord(data.meta) ? data.meta : null) : data;
  const base = p.file.replace(/\.json$/, "");
  const id = holder && typeof holder.id === "string" ? holder.id : undefined;
  if (id !== undefined && id !== base) {
    issues.push({ code: "id-mismatch", severity: "warning", section, message: `ファイル名 (${base}) と中の id (${id}) が違います。一覧・参照はどちらかが見つからなくなります`, ref: p.ref });
  }
  return { issues, uuidless: !!holder && !holder.uuid };
}

/** 実体のある設計の id (画面は、旧形式・旧配置も「ある」として数える) */
const existingIdsFor = (kind: "screen" | "table" | "processFlow", root: string): Promise<string[]> =>
  kind === "screen" ? listScreenIdsIncludingLegacy(root) : listExistingEntityIds(kind, root).catch(() => [] as string[]);

async function computeScan(root: string): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];
  const dataRoot = await resolveDataRoot(root).catch(() => null);
  if (!dataRoot) return issues;
  const uuidless = { count: 0 };
  for (const { kind, label } of KINDS) {
    const dirs = kind === "processFlow" ? [actionsDir(dataRoot), entityDirOf(kind, dataRoot)] : [entityDirOf(kind, dataRoot)];
    for (const dir of dirs) {
      for (const file of await listJsonFiles(dir)) {
        const id = file.replace(/\.json$/, "").replace(/\.design$/, "");
        const ref = kind === "screen" || kind === "table" || kind === "processFlow" ? { kind, id } : undefined;
        { const r = await probeFile(dir, { file, label, kind, ref }, dataRoot); issues.push(...r.issues); if (r.uuidless) uuidless.count++; }
      }
    }
  }
  for (const d of EXTRA_DIRS) {
    const dir = path.join(dataRoot, d);
    for (const file of await listJsonFiles(dir)) { const r = await probeFile(dir, { file, label: "設計ファイル" }, dataRoot); issues.push(...r.issues); if (r.uuidless) uuidless.count++; }
  }
  // 汎用定義 (種類ごとのフォルダ)
  const genRoot = path.join(dataRoot, "generic-definitions");
  let kinds: string[] = [];
  try { kinds = (await fs.readdir(genRoot, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); } catch { /* 無い */ }
  for (const k of kinds.sort()) {
    const dir = path.join(genRoot, k);
    for (const file of await listJsonFiles(dir)) { const r = await probeFile(dir, { file, label: "汎用定義" }, dataRoot); issues.push(...r.issues); if (r.uuidless) uuidless.count++; }
  }

  // 一覧 (harmony.json) にあるのに、ファイルが無い項目
  const project = await readProject(root).catch(() => null);
  if (isRecord(project) && isRecord(project.entities)) {
    const entities = project.entities;
    const checks: Array<{ key: string; kind: "screen" | "table" | "processFlow"; label: string }> = [
      { key: "screens", kind: "screen", label: "画面" }, { key: "tables", kind: "table", label: "テーブル" }, { key: "processFlows", kind: "processFlow", label: "処理フロー" },
    ];
    for (const c of checks) {
      const list = Array.isArray(entities[c.key]) ? entities[c.key] as unknown[] : [];
      const existing = new Set(await existingIdsFor(c.kind, root));
      for (const e of list) {
        if (!isRecord(e) || typeof e.id !== "string") continue;
        if (!existing.has(e.id)) {
          issues.push({ code: "registry-missing-file", severity: "warning", section: `${c.label} ${typeof e.name === "string" && e.name ? e.name : e.id}`, message: `一覧 (harmony.json) にありますが、ファイル (${c.kind === "table" ? "tables" : c.kind === "screen" ? "screens" : "process-flows"}/${e.id}.json) が見つかりません。一覧から外すには「一覧の食い違いを直す」(AI: designer__repair_registry) を使ってください`, ref: { kind: c.kind, id: e.id } });
        }
      }
    }
  }
  // 最上位の旧形式の項目 (v3 のスキーマに無い。画面がワークスペースを開けなくなる)
  const legacyKeys = findLegacyProjectKeys(project);
  if (legacyKeys.length > 0) {
    issues.push({ code: "registry-legacy-keys", severity: "warning", maintenance: true, section: "一覧", message: `harmony.json の最上位に、v3 のスキーマに無い旧形式の項目があります (${legacyKeys.join("、")})。画面でワークスペースを開けなくなります。取り除くには「一覧の食い違いを直す」(AI: designer__repair_registry。予行を見てから apply: true) を使ってください` });
  }
  // ファイルはあるが、一覧に載っていない設計 (読み出しでは一覧に足して扱っている。一覧へ書くのは「一覧の食い違いを直す」)
  if (isRecord(project)) {
    const { unregistered } = await mergeUnregisteredEntities(project, root).catch(() => ({ unregistered: [] as Array<{ kind: string; id: string }> }));
    if (unregistered.length > 0) {
      issues.push({ code: "registry-unregistered", severity: "info", maintenance: true, section: "一覧", message: `一覧 (harmony.json) に載っていない設計ファイルが ${unregistered.length} 件あります (${unregistered.slice(0, 3).map((u) => `${u.kind}:${u.id}`).join("、")}${unregistered.length > 3 ? " ほか" : ""})。読み出しでは一覧に足して扱っています。一覧へ書くには「一覧の食い違いを直す」(AI: designer__repair_registry) を使ってください` });
    }
  }
  if (uuidless.count > 0) {
    issues.push({ code: "uuid-unsaved", severity: "info", maintenance: true, section: "uuid", message: `uuid がファイルに保存されていない設計が ${uuidless.count} 件あります (読み出しでは、種類と id から決めた値で補っています。保存したときに固定されます)。いま固定するには designer__persist_uuids を使ってください` });
  }
  return issues;
}

/** データが変わらないあいだは、検査し直さず前の結果を使う */
export const scanWorkspaceHealth: (root: string) => Promise<HealthIssue[]> = memoizeBySignature(computeScan);

export interface RegistryRepairPlan {
  /** 一覧に足す (ファイルはあるが一覧に載っていない) */
  add: Array<{ kind: string; id: string }>;
  /** 一覧から外す (一覧にあるが、ファイルが無い) */
  remove: Array<{ kind: string; id: string }>;
  /** harmony.json の最上位から取り除く、旧形式の項目の名前 (v3 のスキーマに無い。#1568) */
  removeKeys: string[];
  applied: boolean;
}

/** 一覧 (harmony.json) とファイルの食い違いを直す。apply が true のときだけ書く (予行が既定) */
export async function repairRegistry(root: string, apply: boolean): Promise<RegistryRepairPlan> {
  const project = await readProject(root);
  if (!isRecord(project)) throw new Error("harmony.json を読めません");
  const merged = await mergeUnregisteredEntities(project, root);
  const add = merged.unregistered.map((u) => ({ kind: u.kind, id: u.id }));
  const mergedProject = isRecord(merged.project) ? merged.project : project;
  const removeKeys = findLegacyProjectKeys(mergedProject);
  const next: Record<string, unknown> = { ...mergedProject };
  for (const k of removeKeys) delete next[k];
  const entities: Record<string, unknown> = isRecord(next.entities) ? { ...next.entities } : {};
  const remove: Array<{ kind: string; id: string }> = [];
  for (const c of [{ key: "screens", kind: "screen" }, { key: "tables", kind: "table" }, { key: "processFlows", kind: "processFlow" }] as const) {
    const list = Array.isArray(entities[c.key]) ? entities[c.key] as unknown[] : [];
    const existing = new Set(await existingIdsFor(c.kind, root));
    const kept = list.filter((e) => {
      if (!isRecord(e) || typeof e.id !== "string") return true;
      if (existing.has(e.id)) return true;
      remove.push({ kind: c.kind, id: e.id });
      return false;
    });
    if (kept.length !== list.length) entities[c.key] = kept;
  }
  const changed = add.length > 0 || remove.length > 0 || removeKeys.length > 0;
  if (apply && changed) await writeProject({ ...next, entities }, root);
  return { add, remove, removeKeys, applied: apply && changed };
}

export interface UuidPersistResult { files: string[]; applied: boolean }

/** `uuid` を `id` の直後に入れた新しいオブジェクト (読みやすさのため。id が無ければ先頭) */
function withUuid(obj: Record<string, unknown>, uuid: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let placed = false;
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v;
    if (k === "id" && !placed) { out.uuid = uuid; placed = true; }
  }
  return placed ? out : { uuid, ...obj };
}

/** uuid が未保存の設計に、読み出しで補っている値 (種類 + id から決めた値) を書いて固定する。apply が true のときだけ書く */
export async function persistDerivedUuids(root: string, apply: boolean): Promise<UuidPersistResult> {
  const dataRoot = await resolveDataRoot(root);
  const files: string[] = [];
  for (const { kind } of KINDS) {
    const dirs = kind === "processFlow" ? [actionsDir(dataRoot), entityDirOf(kind, dataRoot)] : [entityDirOf(kind, dataRoot)];
    for (const dir of dirs) {
      for (const file of await listJsonFiles(dir)) {
        if (file.endsWith(".design.json")) continue;
        const full = path.join(dir, file);
        let data: unknown;
        try { data = JSON.parse(await fs.readFile(full, "utf-8")); } catch { continue; }
        if (!isRecord(data)) continue;
        if (kind === "screen" && isLegacyGrapesScreen(data)) continue; // 旧形式は、保存のときに変換して uuid が付く
        const holder = kind === "processFlow" ? (isRecord(data.meta) ? data.meta : null) : data;
        if (!holder || holder.uuid) continue;
        const id = typeof holder.id === "string" && holder.id ? holder.id : file.replace(/\.json$/, "");
        files.push(path.relative(dataRoot, full).split(path.sep).join("/"));
        if (!apply) continue;
        const uuid = deriveStableUuid(kind, id, await projectSaltFor(full));
        const next = kind === "processFlow" ? { ...data, meta: withUuid(holder, uuid) } : withUuid(data, uuid);
        await writeJsonFile(full, next);
      }
    }
  }
  return { files, applied: apply && files.length > 0 };
}
