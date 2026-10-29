/**
 * 画面・処理フロー・テーブル・業務フロー・帳票・ページレイアウト以外の設計を、AI が読み書きする MCP tool handler。
 *
 * - designer__list_designs / get_design / save_design / delete_design   シーケンス・ビュー・ビュー定義・汎用定義 (メッセージ・ドメイン型 など 21 種)
 * - designer__get_conventions / save_conventions                       規約 (conventions.json。ロール・権限・上限値・正規表現・DB 規約など)
 * - designer__import_ddl / import_openapi                             DDL (CREATE TABLE) からテーブルを、OpenAPI から処理フローの雛形を作る (既定は予行。apply: true で保存)
 * - designer__get_tech_stack / save_tech_stack                         技術スタック (harmony.json の techStack。コード生成の指針)
 *
 * どれも画面と同じ原本を読み書きする。設計の途中でも保存でき (draft-state)、スキーマに合わない点は保存を妨げず、点検 (check_design) に出る。
 * 仕様: docs/spec/mcp-design-access.md
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  deleteGenericDefinition, deleteSequence, deleteView, deleteViewDefinition, listEntitiesReadOnly, listGenericDefinitionsReadOnly, readEntityReadOnly,
  readConventions, readGenericDefinition, readProject, readSequence, readView, readViewDefinition,
  writeConventions, writeGenericDefinition, writeProject, writeSequence, writeView, writeViewDefinition,
} from "../projectStorage.js";
import { randomUUID } from "node:crypto";
import { importOpenApi, parseDdl } from "@harmony/shared";
import { LIMITS, confusionStore, type ConfusionEntry } from "../ops/feedback.js";
import { GENERIC_DEFINITION_KINDS } from "../designSearch.js";
import { listExistingEntityIds, writeProcessFlow, writeTable } from "../projectStorage.js";
import { isValidEntityId } from "../security/idValidator.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";
import { assertSafeName } from "../security/idValidator.js";
import { wsBridge } from "../wsBridge.js";
import { workspaceContextManager } from "../workspaceState.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bad = (m: string) => new McpError(ErrorCode.InvalidParams, m);

/** 取り込みの入力と、1 回に書く件数の上限 (大きな入力・大量の書き込みで止まらないように) */
const MAX_IMPORT_SQL_CHARS = 512 * 1024; // DDL の解析は列数の 2 乗に近い。512 KiB なら 1 秒未満
const MAX_IMPORT_WRITES = 500; // OpenAPI の取り込み上限 (500 operation) に合わせる
const PREVIEW_LIMIT = 100; // 予行の応答に載せる件数 (残りは「ほか N 件」)

/** 一覧の件数の制限 (limit 既定 200 / 最大 1000、offset 既定 0)。超えた分は hasMore で知らせる */
export function pageOf<T>(items: T[], a: Record<string, unknown>, defaultLimit = 200): { items: T[]; total: number; offset: number; limit: number; hasMore: boolean } {
  const limit = typeof a.limit === "number" && Number.isFinite(a.limit) ? Math.max(1, Math.min(1000, Math.floor(a.limit))) : defaultLimit;
  const offset = typeof a.offset === "number" && Number.isFinite(a.offset) ? Math.max(0, Math.floor(a.offset)) : 0;
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, hasMore: offset + limit < items.length };
}

const clip = <T,>(items: T[]): { items: T[]; more: number } => ({ items: items.slice(0, PREVIEW_LIMIT), more: Math.max(0, items.length - PREVIEW_LIMIT) });

/** 保存の前に、すべての id を検査する (途中で止まって一部だけ書かれないように) */
function invalidIds(ids: string[]): string[] { return ids.filter((id) => !isValidEntityId(id)); }

/** 上書きするとき、元の作成日時を引き継ぐ */
async function createdAtOf(kind: "table" | "processFlow", id: string, root: string): Promise<string | undefined> {
  const e = await readEntityReadOnly(kind, id, root).catch(() => null);
  const meta = isRecord(e) ? (kind === "processFlow" && isRecord(e.meta) ? e.meta : e) : null;
  return meta && typeof meta.createdAt === "string" ? meta.createdAt : undefined;
}

export const DESIGN_KINDS = ["sequence", "view", "viewDefinition", "genericDefinition"] as const;
type DesignKind = (typeof DESIGN_KINDS)[number];

function kindOf(a: Record<string, unknown>): DesignKind {
  if (!(DESIGN_KINDS as readonly string[]).includes(a.kind as string)) throw bad(`kind は ${DESIGN_KINDS.join(" / ")} のどれかです`);
  return a.kind as DesignKind;
}

/** 汎用定義の種類 (メッセージ・ドメイン型など)。genericDefinition のときだけ必要 */
function definitionKindOf(a: Record<string, unknown>): string {
  if (typeof a.definitionKind !== "string" || !(GENERIC_DEFINITION_KINDS as readonly string[]).includes(a.definitionKind)) {
    throw bad(`genericDefinition には definitionKind が必要です (${GENERIC_DEFINITION_KINDS.join(" / ")})`);
  }
  return a.definitionKind;
}

/** 一覧に出す要約 (中身は get_design で読む) */
function summary(kind: DesignKind, e: Record<string, unknown>, definitionKind?: string): Record<string, unknown> {
  if (kind === "genericDefinition") return { definitionKind, name: e.name, description: e.description, maturity: e.maturity };
  return { id: e.id, name: e.name, description: e.description, maturity: e.maturity };
}

export const handleDesignKindsTool: ToolHandler = async (name, args, root, sessionId) => {
  const a = args ?? {};
  const wsId = () => workspaceContextManager.getActivePath(sessionId) ?? root;

  switch (name) {
    case "designer__list_designs": {
      const kind = kindOf(a);
      if (kind === "genericDefinition") {
        const kinds = typeof a.definitionKind === "string" ? [definitionKindOf(a)] : [...GENERIC_DEFINITION_KINDS];
        const out: Array<Record<string, unknown>> = [];
        for (const dk of kinds) for (const e of await listGenericDefinitionsReadOnly(root, dk)) if (isRecord(e)) out.push(summary(kind, e, dk));
        const pg = pageOf(out, a);
        return json({ kind, count: pg.total, offset: pg.offset, hasMore: pg.hasMore, items: pg.items });
      }
      // 一覧は読むだけ (フォルダを作らない読み出しを使う。読み取り専用の環境でも呼べるように)
      const list = await listEntitiesReadOnly(kind, root);
      const pg = pageOf(list.filter(isRecord).map((e) => summary(kind, e)), a);
      return json({ kind, count: pg.total, offset: pg.offset, hasMore: pg.hasMore, items: pg.items });
    }

    case "designer__get_design": {
      const kind = kindOf(a);
      if (kind === "genericDefinition") {
        const dk = definitionKindOf(a);
        try { assertSafeName(a.name, "name"); } catch (e) { throw bad((e as Error).message); }
        const found = await readGenericDefinition(a.name as string, dk, root);
        if (!found) throw bad(`${dk}「${a.name}」が見つかりません (designer__list_designs で一覧)`);
        return json(found);
      }
      assertEntityIdMcp(a.id, "id");
      const read = kind === "sequence" ? readSequence : kind === "view" ? readView : readViewDefinition;
      const found = await read(a.id, root);
      if (!found) throw bad(`${kind}「${a.id}」が見つかりません (designer__list_designs で一覧)`);
      return json(found);
    }

    case "designer__save_design": {
      const kind = kindOf(a);
      if (!isRecord(a.design)) throw bad("design は JSON のオブジェクトで指定してください");
      if (kind === "genericDefinition") {
        const dk = definitionKindOf(a);
        const nm = typeof a.name === "string" ? a.name : typeof a.design.name === "string" ? a.design.name : undefined;
        try { assertSafeName(nm, "name"); } catch (e) { throw bad((e as Error).message); }
        if (typeof a.name === "string" && typeof a.design.name === "string" && a.name !== a.design.name) throw bad(`name「${a.name}」と design.name「${a.design.name}」が違います。どちらかにそろえてください`);
        if (typeof a.design.kind === "string" && a.design.kind !== dk) throw bad(`design.kind「${a.design.kind}」が definitionKind「${dk}」と違います`);
        await writeGenericDefinition(nm!, dk, { ...a.design, kind: dk, name: nm }, root);
        wsBridge.broadcast({ wsId: wsId(), event: "genericDefinitionChanged", data: { kind: dk, name: nm } });
        return json({ saved: true, kind, definitionKind: dk, name: nm });
      }
      assertEntityIdMcp(a.id, "id");
      const doc = { ...a.design, id: a.id };
      if (kind === "sequence") { await writeSequence(a.id, doc, root); wsBridge.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId: a.id } }); }
      else if (kind === "view") { await writeView(a.id, doc, root); wsBridge.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId: a.id } }); }
      else { await writeViewDefinition(a.id, doc, root); wsBridge.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId: a.id } }); }
      return json({ saved: true, kind, id: a.id, note: "保存しました。スキーマ・参照の確認は designer__check_design で" });
    }

    case "designer__delete_design": {
      const kind = kindOf(a);
      if (kind === "genericDefinition") {
        const dk = definitionKindOf(a);
        try { assertSafeName(a.name, "name"); } catch (e) { throw bad((e as Error).message); }
        if (!(await readGenericDefinition(a.name as string, dk, root))) return json({ deleted: false, kind, definitionKind: dk, name: a.name, note: "ありませんでした" });
        await deleteGenericDefinition(a.name as string, dk, root);
        wsBridge.broadcast({ wsId: wsId(), event: "genericDefinitionChanged", data: { kind: dk, name: a.name, deleted: true } });
        return json({ deleted: true, kind, definitionKind: dk, name: a.name });
      }
      assertEntityIdMcp(a.id, "id");
      if (!(await readEntityReadOnly(kind, a.id, root))) return json({ deleted: false, kind, id: a.id, note: "ありませんでした" });
      if (kind === "sequence") { await deleteSequence(a.id, root); wsBridge.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId: a.id, deleted: true } }); }
      else if (kind === "view") { await deleteView(a.id, root); wsBridge.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId: a.id, deleted: true } }); }
      else { await deleteViewDefinition(a.id, root); wsBridge.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId: a.id, deleted: true } }); }
      return json({ deleted: true, kind, id: a.id, note: "参照している設計は designer__find_references で確かめてください" });
    }

    case "designer__get_conventions": {
      const c = await readConventions(root);
      return c ? json(c) : { content: [{ type: "text" as const, text: "規約 (conventions.json) はまだありません (未設定)。designer__save_conventions で作れます" }] };
    }

    case "designer__save_conventions": {
      if (!isRecord(a.conventions)) throw bad("conventions は JSON のオブジェクトで指定してください");
      await writeConventions(a.conventions, root);
      wsBridge.broadcast({ wsId: wsId(), event: "conventionsChanged", data: {} });
      return json({ saved: true, note: "規約は全体を置き換えます。直した点は designer__check_design で確かめてください" });
    }

    case "designer__import_ddl": {
      if (typeof a.sql !== "string" || !a.sql.trim()) throw bad("sql は必須です (CREATE TABLE を含む DDL。pg_dump -s / mysqldump --no-data の出力でもよい)");
      if (a.sql.length > MAX_IMPORT_SQL_CHARS) throw bad(`sql が大きすぎます (${MAX_IMPORT_SQL_CHARS} 文字まで。テーブルごとに分けて渡してください)`);
      const result = parseDdl(a.sql);
      const only = Array.isArray(a.ids) ? new Set(a.ids.filter((x): x is string => typeof x === "string")) : null;
      const picked = only ? result.tables.filter((t) => only.has(t.id)) : result.tables;
      const existing = new Set(await listExistingEntityIds("table", root));
      const bads = invalidIds(picked.map((t) => t.id));
      const items = clip(picked.map((t) => ({ id: t.id, physicalName: t.physicalName, name: t.name, columns: t.columns.length, exists: existing.has(t.id), ...(bads.includes(t.id) ? { invalidId: true } : {}) })));
      const base = { total: picked.length, tables: items.items, ...(items.more ? { moreTables: items.more } : {}), warnings: clip(result.warnings).items, skipped: clip(result.skipped).items, ...(bads.length ? { invalidIds: bads } : {}) };
      if (a.apply !== true) {
        return json({ applied: false, ...base, note: `予行です。保存するには apply: true (同じ id がすでにあるものは overwrite: true のときだけ置き換える。置き換えは中身を丸ごと入れ替える)。一度に保存できるのは ${MAX_IMPORT_WRITES} 件まで${picked.length > MAX_IMPORT_WRITES ? ` — ${picked.length} 件あるので ids で絞ってください` : ""}` });
      }
      if (picked.length > MAX_IMPORT_WRITES) throw bad(`一度に保存できるのは ${MAX_IMPORT_WRITES} 件までです (${picked.length} 件)。ids で絞ってください`);
      if (bads.length) throw bad(`id が使えない形のテーブルがあります (何も保存していません): ${bads.slice(0, 5).join(", ")}。DDL のテーブル名を変えるか、ids でほかを選んでください`);
      const now = new Date().toISOString();
      const written: string[] = [], kept: string[] = [];
      for (const t of picked) {
        if (existing.has(t.id) && a.overwrite !== true) { kept.push(t.id); continue; }
        const createdAt = existing.has(t.id) ? (await createdAtOf("table", t.id, root)) ?? now : now;
        await writeTable(t.id, { ...t, createdAt, updatedAt: now }, root);
        written.push(t.id);
      }
      if (written.length) wsBridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } });
      return json({ applied: true, written, keptExisting: kept, ...base, note: "保存しました。設計の確認は designer__check_design で" });
    }

    case "designer__import_openapi": {
      if (!isRecord(a.spec)) throw bad("spec は OpenAPI 文書 (JSON のオブジェクト) で指定してください");
      const result = importOpenApi(a.spec);
      const only = Array.isArray(a.ids) ? new Set(a.ids.filter((x): x is string => typeof x === "string")) : null;
      const picked = only ? result.flows.filter((f) => only.has(f.id)) : result.flows;
      const existing = new Set(await listExistingEntityIds("processFlow", root));
      const bads = invalidIds(picked.map((f) => f.id));
      const items = clip(picked.map((f) => ({ id: f.id, name: f.name, method: f.method, path: f.path, exists: existing.has(f.id), ...(bads.includes(f.id) ? { invalidId: true } : {}) })));
      const base = { title: result.title, total: picked.length, flows: items.items, ...(items.more ? { moreFlows: items.more } : {}), warnings: clip(result.warnings).items, ...(bads.length ? { invalidIds: bads } : {}) };
      if (a.apply !== true) {
        return json({ applied: false, ...base, note: `予行です。保存するには apply: true。作られるのは、入出力・応答 (HTTP の約束) だけの雛形で、工程 (steps) は空です。同じ id は overwrite: true のときだけ丸ごと置き換える。一度に保存できるのは ${MAX_IMPORT_WRITES} 件まで` });
      }
      if (picked.length > MAX_IMPORT_WRITES) throw bad(`一度に保存できるのは ${MAX_IMPORT_WRITES} 件までです (${picked.length} 件)。ids で絞ってください`);
      if (bads.length) throw bad(`id が使えない形の操作があります (何も保存していません): ${bads.slice(0, 5).join(", ")}。operationId を短くするか、ids でほかを選んでください`);
      const now = new Date().toISOString();
      const written: string[] = [], kept: string[] = [];
      for (const f of picked) {
        if (existing.has(f.id) && a.overwrite !== true) { kept.push(f.id); continue; }
        const createdAt = existing.has(f.id) ? (await createdAtOf("processFlow", f.id, root)) ?? now : now;
        await writeProcessFlow(f.id, { ...f.flow, meta: { ...f.flow.meta, createdAt, updatedAt: now } }, root);
        written.push(f.id);
      }
      if (written.length) wsBridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } });
      return json({ applied: true, written, keptExisting: kept, ...base, note: "保存しました。工程は /create-flow か add_step で足してください" });
    }

    case "designer__report_confusion": {
      const text = (v: unknown, max: number, label: string, required = false): string | undefined => {
        if (v === undefined || v === null || v === "") { if (required) throw bad(`${label} は必須です`); return undefined; }
        if (typeof v !== "string") throw bad(`${label} は文字列で指定してください`);
        if (v.length > max) throw bad(`${label} は ${max} 文字までです (${v.length} 文字)`);
        const t = v.trim();
        if (!t && required) throw bad(`${label} は必須です (空白だけは使えません)`);
        return t || undefined;
      };
      const topic = text(a.topic, LIMITS.topic, "topic", true)!;
      const entry: ConfusionEntry = {
        id: `cf-${randomUUID().slice(0, 8)}`, at: new Date().toISOString(), topic,
        ...(text(a.detail, LIMITS.detail, "detail") ? { detail: text(a.detail, LIMITS.detail, "detail") } : {}),
        ...(text(a.tool, LIMITS.tool, "tool") ? { tool: text(a.tool, LIMITS.tool, "tool") } : {}),
        ...(text(a.doc, LIMITS.doc, "doc") ? { doc: text(a.doc, LIMITS.doc, "doc") } : {}),
        ...(text(a.expected, LIMITS.expected, "expected") ? { expected: text(a.expected, LIMITS.expected, "expected") } : {}),
      };
      let res;
      try { res = await confusionStore.update(root, (f) => ({ entries: [...f.entries, entry] }), { discardUnreadable: true }); }
      catch (e) { throw bad(`詰まった点を記録できませんでした (${(e as Error).message})。記録のファイル (.harmony-ops/ai-feedback.json) の問題で、作業には影響しません。利用者に知らせて、作業を続けてください`); }
      return json({ recorded: true, id: entry.id, total: res.value.entries.length, note: "記録しました (ワークスペースの .harmony-ops/ai-feedback.json。git には載りません)。利用者は npm run ai:feedback で集計して、資料・tool の説明の改善に使います" });
    }

    case "designer__get_tech_stack": {
      const project = await readProject(root);
      return isRecord(project) && project.techStack ? json(project.techStack) : { content: [{ type: "text" as const, text: "技術スタック (harmony.json の techStack) は未設定です。designer__save_tech_stack で設定できます" }] };
    }

    case "designer__save_tech_stack": {
      if (!isRecord(a.techStack)) throw bad("techStack は JSON のオブジェクトで指定してください (designer / backend / database など)");
      const project = await readProject(root);
      if (!isRecord(project)) throw bad("harmony.json を読めません (ワークスペースを確かめてください)");
      await writeProject({ ...project, techStack: a.techStack }, root);
      wsBridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } });
      return json({ saved: true, note: "技術スタックは全体を置き換えます" });
    }

    default:
      return null;
  }
};
