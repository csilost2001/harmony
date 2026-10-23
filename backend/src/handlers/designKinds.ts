/**
 * 画面・処理フロー・テーブル・業務フロー・帳票・ページレイアウト以外の設計を、AI が読み書きする MCP tool handler。
 *
 * - designer__list_designs / get_design / save_design / delete_design   シーケンス・ビュー・ビュー定義・汎用定義 (メッセージ・ドメイン型 など 17 種)
 * - designer__get_conventions / save_conventions                       規約 (conventions.json。ロール・権限・上限値・正規表現・DB 規約など)
 * - designer__import_ddl / import_openapi                             DDL (CREATE TABLE) からテーブルを、OpenAPI から処理フローの雛形を作る (既定は予行。apply: true で保存)
 * - designer__get_tech_stack / save_tech_stack                         技術スタック (harmony.json の techStack。コード生成の指針)
 *
 * どれも画面と同じ原本を読み書きする。設計の途中でも保存でき (draft-state)、スキーマに合わない点は保存を妨げず、点検 (check_design) に出る。
 * 仕様: docs/spec/mcp-design-access.md
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  deleteGenericDefinition, deleteSequence, deleteView, deleteViewDefinition, listAllGenericDefinitions, listAllSequences, listAllViewDefinitions, listAllViews,
  readConventions, readGenericDefinition, readProject, readSequence, readView, readViewDefinition,
  writeConventions, writeGenericDefinition, writeProject, writeSequence, writeView, writeViewDefinition,
} from "../projectStorage.js";
import { importOpenApi, parseDdl } from "@harmony/shared";
import { GENERIC_DEFINITION_KINDS } from "../designSearch.js";
import { listExistingEntityIds, writeProcessFlow, writeTable } from "../projectStorage.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";
import { assertSafeName } from "../security/idValidator.js";
import { wsBridge } from "../wsBridge.js";
import { workspaceContextManager } from "../workspaceState.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bad = (m: string) => new McpError(ErrorCode.InvalidParams, m);

/** 取り込みの入力と、1 回に書く件数の上限 (大きな入力・大量の書き込みで止まらないように) */
const MAX_IMPORT_SQL_CHARS = 2 * 1024 * 1024;
const MAX_IMPORT_WRITES = 200;

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
        for (const dk of kinds) for (const e of await listAllGenericDefinitions(root, dk)) if (isRecord(e)) out.push(summary(kind, e, dk));
        return json({ kind, count: out.length, items: out });
      }
      const list = kind === "sequence" ? await listAllSequences(root) : kind === "view" ? await listAllViews(root) : await listAllViewDefinitions(root);
      const items = list.filter(isRecord).map((e) => summary(kind, e));
      return json({ kind, count: items.length, items });
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
        await writeGenericDefinition(nm!, dk, { ...a.design, name: nm }, root);
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
        await deleteGenericDefinition(a.name as string, dk, root);
        wsBridge.broadcast({ wsId: wsId(), event: "genericDefinitionChanged", data: { kind: dk, name: a.name, deleted: true } });
        return json({ deleted: true, kind, definitionKind: dk, name: a.name });
      }
      assertEntityIdMcp(a.id, "id");
      if (kind === "sequence") { await deleteSequence(a.id, root); wsBridge.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId: a.id, deleted: true } }); }
      else if (kind === "view") { await deleteView(a.id, root); wsBridge.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId: a.id, deleted: true } }); }
      else { await deleteViewDefinition(a.id, root); wsBridge.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId: a.id, deleted: true } }); }
      return json({ deleted: true, kind, id: a.id, note: "参照している設計は designer__find_references で確かめてください" });
    }

    case "designer__get_conventions": {
      const c = await readConventions(root);
      return json(c ?? { note: "規約 (conventions.json) はまだありません。designer__save_conventions で作れます" });
    }

    case "designer__save_conventions": {
      if (!isRecord(a.conventions)) throw bad("conventions は JSON のオブジェクトで指定してください");
      await writeConventions(a.conventions, root);
      wsBridge.broadcast({ wsId: wsId(), event: "conventionsChanged", data: {} });
      return json({ saved: true, note: "規約は全体を置き換えます。直した点は designer__check_design で確かめてください" });
    }

    case "designer__import_ddl": {
      if (typeof a.sql !== "string" || !a.sql.trim()) throw bad("sql は必須です (CREATE TABLE を含む DDL。pg_dump -s / mysqldump --no-data の出力でもよい)");
      if (a.sql.length > MAX_IMPORT_SQL_CHARS) throw bad(`sql が大きすぎます (${MAX_IMPORT_SQL_CHARS} 文字まで)`);
      const result = parseDdl(a.sql);
      const existing = new Set(await listExistingEntityIds("table", root));
      const items = result.tables.map((t) => ({ id: t.id, physicalName: t.physicalName, name: t.name, columns: t.columns.length, exists: existing.has(t.id) }));
      const base = { tables: items, warnings: result.warnings, skipped: result.skipped };
      if (a.apply !== true) return json({ applied: false, ...base, note: "予行です。保存するには apply: true (同じ id がすでにあるものは overwrite: true のときだけ置き換える)" });
      if (result.tables.length > MAX_IMPORT_WRITES) throw bad(`一度に保存できるのは ${MAX_IMPORT_WRITES} 件までです (${result.tables.length} 件)`);
      const now = new Date().toISOString();
      const written: string[] = [], kept: string[] = [];
      for (const t of result.tables) {
        if (existing.has(t.id) && a.overwrite !== true) { kept.push(t.id); continue; }
        assertEntityIdMcp(t.id, "table id");
        await writeTable(t.id, { ...t, createdAt: now, updatedAt: now }, root);
        written.push(t.id);
      }
      if (written.length) wsBridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } });
      return json({ applied: true, written, keptExisting: kept, ...base, note: "保存しました。設計の確認は designer__check_design で" });
    }

    case "designer__import_openapi": {
      if (!isRecord(a.spec)) throw bad("spec は OpenAPI 文書 (JSON のオブジェクト) で指定してください");
      const result = importOpenApi(a.spec);
      const existing = new Set(await listExistingEntityIds("processFlow", root));
      const items = result.flows.map((f) => ({ id: f.id, name: f.name, method: f.method, path: f.path, exists: existing.has(f.id) }));
      const base = { title: result.title, flows: items, warnings: result.warnings };
      if (a.apply !== true) return json({ applied: false, ...base, note: "予行です。保存するには apply: true。作られるのは、入出力・応答 (HTTP の約束) だけの雛形で、工程 (steps) は空です" });
      if (result.flows.length > MAX_IMPORT_WRITES) throw bad(`一度に保存できるのは ${MAX_IMPORT_WRITES} 件までです (${result.flows.length} 件)`);
      const now = new Date().toISOString();
      const written: string[] = [], kept: string[] = [];
      for (const f of result.flows) {
        if (existing.has(f.id) && a.overwrite !== true) { kept.push(f.id); continue; }
        assertEntityIdMcp(f.id, "processFlow id");
        await writeProcessFlow(f.id, { ...f.flow, meta: { ...f.flow.meta, createdAt: now, updatedAt: now } }, root);
        written.push(f.id);
      }
      if (written.length) wsBridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } });
      return json({ applied: true, written, keptExisting: kept, ...base, note: "保存しました。工程は /create-flow か add_step で足してください" });
    }

    case "designer__get_tech_stack": {
      const project = await readProject(root);
      return json(isRecord(project) && project.techStack ? project.techStack : { note: "技術スタック (harmony.json の techStack) は未設定です" });
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
