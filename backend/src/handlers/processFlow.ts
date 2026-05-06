/**
 * ProcessFlow / step / catalog 関連 MCP tool handler (#261)
 *
 * 対象 (17 ツール):
 * - designer__list_process_flows / get_process_flow
 * - designer__add_process_flow / update_process_flow / delete_process_flow
 * - designer__add_action / add_step / update_step / remove_step / move_step
 * - designer__set_maturity / add_step_note
 * - designer__add_catalog_entry / remove_catalog_entry
 * - designer__export_arazzo (#427 P3-3)
 * - designer__solution_pack / solution_unpack (#427 P3-4)
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import fs from "node:fs";
import AdmZip from "adm-zip";
import {
  readProcessFlow,
  writeProcessFlow,
  deleteProcessFlow as deleteProcessFlowFile,
  listProcessFlows as listProcessFlowFiles,
  readProject,
  writeProject,
  dataDir,
  readExtensionsBundle,
  writeExtensionsFile,
  type ExtensionFileKind,
} from "../projectStorage.js";
import {
  updateStep as editUpdateStep,
  removeStep as editRemoveStep,
  moveStep as editMoveStep,
  setMaturity as editSetMaturity,
  addStepNote as editAddStepNote,
  addCatalogEntry as editAddCatalogEntry,
  removeCatalogEntry as editRemoveCatalogEntry,
  insertStepAt as editInsertStepAt,
  type ProcessFlowDoc,
  type CatalogName,
} from "../processFlowEdits.js";
import { saveAndBroadcast, type ToolHandler } from "../mcpHelpers.js";
import { wsBridge } from "../wsBridge.js";

type ResponseTypeEntry = {
  description?: string;
  schema: Record<string, unknown>;
};

type ResponseTypesFile = {
  namespace: string;
  responseTypes: Record<string, ResponseTypeEntry>;
};

const EXTENSION_PACKAGE_TYPES: ExtensionFileKind[] = ["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"];

function normalizeResponseTypesFile(raw: unknown): ResponseTypesFile {
  const file = raw && typeof raw === "object" ? raw as Partial<ResponseTypesFile> : {};
  const namespace = typeof file.namespace === "string" ? file.namespace : "";
  const responseTypes = file.responseTypes && typeof file.responseTypes === "object" && !Array.isArray(file.responseTypes)
    ? file.responseTypes as Record<string, ResponseTypeEntry>
    : {};
  return { namespace, responseTypes };
}

function namespacedKey(namespace: string | undefined, key: string): string {
  return namespace ? `${namespace}:${key}` : key;
}

async function readResponseTypesFile(root: string): Promise<ResponseTypesFile> {
  const bundle = await readExtensionsBundle(root);
  return normalizeResponseTypesFile(bundle.responseTypes);
}

async function writeResponseTypesFile(file: ResponseTypesFile, root: string): Promise<void> {
  await writeExtensionsFile("responseTypes", file, root, {
    onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "responseTypes" } }),
  });
}

async function handleAddResponseTypeExtension(params: {
  namespace?: unknown;
  key?: unknown;
  schema?: unknown;
  description?: unknown;
}, root: string): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (typeof params.key !== "string" || typeof params.schema !== "object" || params.schema === null || Array.isArray(params.schema)) {
    throw new McpError(ErrorCode.InvalidParams, "key, schema は必須です");
  }
  const namespace = typeof params.namespace === "string" ? params.namespace : "";
  const key = namespacedKey(namespace, params.key);
  const file = await readResponseTypesFile(root);
  file.responseTypes[key] = {
    schema: params.schema as Record<string, unknown>,
    ...(typeof params.description === "string" ? { description: params.description } : {}),
  };
  try {
    await writeResponseTypesFile(file, root);
  } catch (e) {
    throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
  }
  return { content: [{ type: "text", text: `responseTypes.${key} を追加/更新しました。` }] };
}

export const handleProcessFlowTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__list_process_flows": {
      const agList = await listProcessFlowFiles(root) as Array<{ id: string; name: string; type: string; screenId?: string; actions?: unknown[]; updatedAt: string }>;
      if (agList.length === 0) {
        return { content: [{ type: "text", text: "処理フロー定義はまだありません。" }] };
      }
      const lines = agList.map(
        (ag) => `- ${ag.id}  ${ag.name}（${ag.type}）アクション:${ag.actions?.length ?? 0}件`
      );
      return { content: [{ type: "text", text: `処理フロー一覧 (${agList.length}件):\n${lines.join("\n")}` }] };
    }

    case "designer__get_process_flow": {
      if (typeof a.processFlowId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId は必須です");
      }
      // browser-first: ProcessFlowEditor が開いていれば live 状態を取得
      const liveData = await wsBridge.tryCommand("getProcessFlow", { id: a.processFlowId });
      const agData = liveData ?? await readProcessFlow(a.processFlowId, root);
      if (!agData) {
        throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      }
      const source = liveData ? "browser live (unsaved 変更を含む)" : "file";
      const enriched = { _mcpSource: source, ...(agData as Record<string, unknown>) };
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    }

    case "designer__add_process_flow": {
      if (typeof a.name !== "string" || typeof a.type !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "name, type は必須です");
      }
      const agId = `ag-${Date.now()}`;
      const agNow = new Date().toISOString();
      const agDef = {
        id: agId,
        name: a.name,
        type: a.type,
        screenId: typeof a.screenId === "string" ? a.screenId : undefined,
        description: typeof a.description === "string" ? a.description : "",
        actions: [],
        createdAt: agNow,
        updatedAt: agNow,
      };
      await writeProcessFlow(agId, agDef, root);
      const agProject = (await readProject(root) ?? {}) as Record<string, unknown>;
      const agMetas = (agProject.processFlows ?? []) as Array<Record<string, unknown>>;
      agMetas.push({ id: agId, name: a.name, type: a.type, screenId: a.screenId, actionCount: 0, updatedAt: agNow });
      agProject.processFlows = agMetas;
      agProject.updatedAt = agNow;
      await writeProject(agProject, root);
      return { content: [{ type: "text", text: `処理フロー「${a.name}」(${a.type}) を追加しました（ID: ${agId}）` }] };
    }

    case "designer__update_process_flow": {
      if (typeof a.processFlowId !== "string" || !a.definition) {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, definition は必須です");
      }
      const agDef = a.definition as Record<string, unknown>;
      agDef.updatedAt = new Date().toISOString();
      await writeProcessFlow(a.processFlowId, agDef, root);
      const agProject = (await readProject(root) ?? {}) as Record<string, unknown>;
      const agMetas = (agProject.processFlows ?? []) as Array<Record<string, unknown>>;
      const agIdx = agMetas.findIndex((m) => m.id === a.processFlowId);
      const agActions = (agDef.actions ?? []) as unknown[];
      const agMeta = { id: a.processFlowId, name: agDef.name, type: agDef.type, screenId: agDef.screenId, actionCount: agActions.length, updatedAt: agDef.updatedAt };
      if (agIdx >= 0) agMetas[agIdx] = agMeta; else agMetas.push(agMeta);
      agProject.processFlows = agMetas;
      agProject.updatedAt = agDef.updatedAt as string;
      await writeProject(agProject, root);
      return { content: [{ type: "text", text: `処理フロー ${a.processFlowId} を更新しました。` }] };
    }

    case "designer__delete_process_flow": {
      if (typeof a.processFlowId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId は必須です");
      }
      await deleteProcessFlowFile(a.processFlowId, root);
      const agProject = (await readProject(root) ?? {}) as Record<string, unknown>;
      const agMetas = ((agProject.processFlows ?? []) as Array<Record<string, unknown>>).filter((m) => m.id !== a.processFlowId);
      agProject.processFlows = agMetas;
      agProject.updatedAt = new Date().toISOString();
      await writeProject(agProject, root);
      return { content: [{ type: "text", text: `処理フロー ${a.processFlowId} を削除しました。` }] };
    }

    case "designer__add_action": {
      if (typeof a.processFlowId !== "string" || typeof a.name !== "string" || typeof a.trigger !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, name, trigger は必須です");
      }
      const ag = await readProcessFlow(a.processFlowId, root) as Record<string, unknown> | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      const actions = (ag.actions ?? []) as Array<Record<string, unknown>>;
      const actionId = `act-${Date.now()}`;
      actions.push({ id: actionId, name: a.name, trigger: a.trigger, steps: [] });
      ag.actions = actions;
      ag.updatedAt = new Date().toISOString();
      await writeProcessFlow(a.processFlowId, ag, root);
      return { content: [{ type: "text", text: `アクション「${a.name}」を追加しました（ID: ${actionId}）` }] };
    }

    case "designer__add_step": {
      if (typeof a.processFlowId !== "string" || typeof a.actionId !== "string" || typeof a.type !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, actionId, type は必須です");
      }
      // browser-first: ProcessFlowEditor が開いていれば in-memory に適用
      const addApplied = await wsBridge.tryCommand("applyProcessFlowMutation", {
        id: a.processFlowId, type: "designer__add_step", params: a,
      });
      if (addApplied) {
        return { content: [{ type: "text", text: `ステップ（${a.type}）をブラウザで追加しました（保存で確定）` }] };
      }
      // fallback: ファイル書き
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      const stepId = `step-${Date.now()}`;
      const detail = (a.detail ?? {}) as Record<string, unknown>;
      const step = { id: stepId, type: a.type as string, description: (a.description as string) ?? "", ...detail };
      editInsertStepAt(ag, a.actionId as string, step, typeof a.position === "number" ? a.position : undefined);
      await saveAndBroadcast(a.processFlowId, ag, root);
      return { content: [{ type: "text", text: `ステップ（${a.type}）を追加しました（ID: ${stepId}）` }] };
    }

    case "designer__update_step": {
      if (typeof a.processFlowId !== "string" || typeof a.stepId !== "string" || typeof a.patch !== "object" || a.patch === null) {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, stepId, patch は必須です");
      }
      const updApplied = await wsBridge.tryCommand("applyProcessFlowMutation", {
        id: a.processFlowId, type: "designer__update_step", params: a,
      });
      if (updApplied) {
        return { content: [{ type: "text", text: `ステップ ${a.stepId} をブラウザで更新しました（保存で確定）` }] };
      }
      // fallback
      const updAg = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!updAg) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      try {
        editUpdateStep(updAg, a.stepId, a.patch as Record<string, unknown>);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
      await saveAndBroadcast(a.processFlowId, updAg, root);
      return { content: [{ type: "text", text: `ステップ ${a.stepId} を更新しました。` }] };
    }

    case "designer__remove_step": {
      if (typeof a.processFlowId !== "string" || typeof a.stepId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, stepId は必須です");
      }
      const rmApplied = await wsBridge.tryCommand("applyProcessFlowMutation", {
        id: a.processFlowId, type: "designer__remove_step", params: a,
      });
      if (rmApplied) {
        return { content: [{ type: "text", text: `ステップ ${a.stepId} をブラウザで削除しました（保存で確定）` }] };
      }
      // fallback
      const rmAg = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!rmAg) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      try {
        editRemoveStep(rmAg, a.stepId);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
      await saveAndBroadcast(a.processFlowId, rmAg, root);
      return { content: [{ type: "text", text: `ステップ ${a.stepId} を削除しました。` }] };
    }

    case "designer__move_step": {
      if (typeof a.processFlowId !== "string" || typeof a.stepId !== "string" || typeof a.newIndex !== "number") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, stepId, newIndex は必須です");
      }
      const mvApplied = await wsBridge.tryCommand("applyProcessFlowMutation", {
        id: a.processFlowId, type: "designer__move_step", params: a,
      });
      if (mvApplied) {
        return { content: [{ type: "text", text: `ステップ ${a.stepId} をブラウザで位置 ${a.newIndex} に移動しました（保存で確定）` }] };
      }
      // fallback
      const mvAg = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!mvAg) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      try {
        editMoveStep(mvAg, a.stepId, a.newIndex);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
      await saveAndBroadcast(a.processFlowId, mvAg, root);
      return { content: [{ type: "text", text: `ステップ ${a.stepId} を位置 ${a.newIndex} に移動しました。` }] };
    }

    case "designer__set_maturity": {
      if (typeof a.processFlowId !== "string" || typeof a.target !== "string" || typeof a.maturity !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, target, maturity は必須です");
      }
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      try {
        editSetMaturity(ag, a.target as "group" | "action" | "step", a.targetId as string | undefined, a.maturity as "draft" | "provisional" | "committed");
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
      await saveAndBroadcast(a.processFlowId, ag, root);
      return { content: [{ type: "text", text: `maturity を ${a.maturity} に更新しました。` }] };
    }

    case "designer__add_step_note": {
      if (typeof a.processFlowId !== "string" || typeof a.stepId !== "string" || typeof a.type !== "string" || typeof a.body !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, stepId, type, body は必須です");
      }
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      try {
        const res = editAddStepNote(ag, a.stepId, a.type as string, a.body as string);
        await saveAndBroadcast(a.processFlowId, ag, root);
        return { content: [{ type: "text", text: `付箋を追加しました (ID: ${res.id})` }] };
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
    }

    case "designer__list_response_type_extensions": {
      const file = await readResponseTypesFile(root);
      return { content: [{ type: "text", text: JSON.stringify(file.responseTypes, null, 2) }] };
    }

    case "designer__get_response_type_extension": {
      if (typeof a.key !== "string") throw new McpError(ErrorCode.InvalidParams, "key は必須です");
      const file = await readResponseTypesFile(root);
      const entry = file.responseTypes[a.key];
      if (!entry) throw new McpError(ErrorCode.InvalidParams, `responseTypes.${a.key} が見つかりません`);
      return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
    }

    case "designer__add_response_type_extension":
      return await handleAddResponseTypeExtension(a, root);

    case "designer__update_response_type_extension": {
      if (typeof a.key !== "string") throw new McpError(ErrorCode.InvalidParams, "key は必須です");
      const file = await readResponseTypesFile(root);
      const current = file.responseTypes[a.key];
      if (!current) throw new McpError(ErrorCode.InvalidParams, `responseTypes.${a.key} が見つかりません`);
      file.responseTypes[a.key] = {
        ...current,
        ...(typeof a.schema === "object" && a.schema !== null && !Array.isArray(a.schema) ? { schema: a.schema as Record<string, unknown> } : {}),
        ...(typeof a.description === "string" ? { description: a.description } : {}),
      };
      try {
        await writeResponseTypesFile(file, root);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
      }
      return { content: [{ type: "text", text: `responseTypes.${a.key} を更新しました。` }] };
    }

    case "designer__delete_response_type_extension": {
      if (typeof a.key !== "string") throw new McpError(ErrorCode.InvalidParams, "key は必須です");
      const file = await readResponseTypesFile(root);
      delete file.responseTypes[a.key];
      try {
        await writeResponseTypesFile(file, root);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
      }
      return { content: [{ type: "text", text: `responseTypes.${a.key} を削除しました。` }] };
    }

    case "designer__list_extension_packages": {
      const bundle = await readExtensionsBundle(root);
      const packages = EXTENSION_PACKAGE_TYPES.map((type) => {
        const content = bundle[type];
        const body = content && typeof content === "object" ? (content as Record<string, unknown>)[type] : undefined;
        const count = Array.isArray(body) ? body.length : body && typeof body === "object" ? Object.keys(body).length : 0;
        const namespace = content && typeof content === "object" && typeof (content as { namespace?: unknown }).namespace === "string"
          ? (content as { namespace: string }).namespace
          : "";
        return { type, namespace, count, exists: content !== null };
      });
      return { content: [{ type: "text", text: JSON.stringify(packages, null, 2) }] };
    }

    case "designer__get_extension_package": {
      if (typeof a.packageName !== "string" || !EXTENSION_PACKAGE_TYPES.includes(a.packageName as ExtensionFileKind)) {
        throw new McpError(ErrorCode.InvalidParams, "packageName が不正です");
      }
      const bundle = await readExtensionsBundle(root);
      return { content: [{ type: "text", text: JSON.stringify(bundle[a.packageName as ExtensionFileKind], null, 2) }] };
    }

    case "designer__add_catalog_entry": {
      if (typeof a.processFlowId !== "string" || typeof a.catalog !== "string" || typeof a.key !== "string" || typeof a.value !== "object" || a.value === null) {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, catalog, key, value は必須です");
      }
      if (a.catalog === "typeCatalog") {
        console.warn("[deprecation] add_catalog_entry catalogName=typeCatalog is forwarded to add_response_type_extension");
        const value = a.value as Record<string, unknown>;
        return await handleAddResponseTypeExtension({
          namespace: "",
          key: a.key,
          schema: value.schema,
          description: value.description,
        }, root);
      }
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      editAddCatalogEntry(ag, a.catalog as CatalogName, a.key as string, a.value as Record<string, unknown>);
      await saveAndBroadcast(a.processFlowId, ag, root);
      return { content: [{ type: "text", text: `${a.catalog}.${a.key} を追加/更新しました。` }] };
    }

    case "designer__remove_catalog_entry": {
      if (typeof a.processFlowId !== "string" || typeof a.catalog !== "string" || typeof a.key !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, catalog, key は必須です");
      }
      if (a.catalog === "typeCatalog") {
        console.warn("[deprecation] remove_catalog_entry catalogName=typeCatalog is forwarded to delete_response_type_extension");
        const file = await readResponseTypesFile(root);
        delete file.responseTypes[a.key];
        try {
          await writeResponseTypesFile(file, root);
        } catch (e) {
          throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
        }
        return { content: [{ type: "text", text: `responseTypes.${a.key} を削除しました。` }] };
      }
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      editRemoveCatalogEntry(ag, a.catalog as CatalogName, a.key as string);
      await saveAndBroadcast(a.processFlowId, ag, root);
      return { content: [{ type: "text", text: `${a.catalog}.${a.key} を削除しました。` }] };
    }

    case "designer__export_arazzo": {
      if (typeof a.processFlowId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId は必須です");
      }
      const flow = await readProcessFlow(a.processFlowId, root) as Record<string, unknown> | null;
      if (!flow) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);

      const fmt = (a.outputFormat as string | undefined) ?? "yaml";
      const arazzo = buildArazzoDoc(flow);

      let text: string;
      if (fmt === "json") {
        text = JSON.stringify(arazzo, null, 2);
      } else {
        text = toYaml(arazzo).trimStart();
      }
      return { content: [{ type: "text", text }] };
    }

    case "designer__solution_pack": {
      const ids = a.processFlowIds as string[] | undefined;
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, "processFlowIds は 1 件以上の配列が必要です");
      }
      if (typeof a.publisherPrefix !== "string" || typeof a.version !== "string" || typeof a.outputPath !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "publisherPrefix, version, outputPath は必須です");
      }

      const outPath = path.isAbsolute(a.outputPath as string)
        ? (a.outputPath as string)
        : path.join(dataDir(root), a.outputPath as string);

      const zip = new AdmZip();
      const manifest = {
        publisher: a.publisherPrefix,
        version: a.version,
        processFlowIds: ids,
        createdAt: new Date().toISOString(),
      };
      zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

      const missing: string[] = [];
      for (const id of ids) {
        const doc = await readProcessFlow(id, root);
        if (!doc) { missing.push(id); continue; }
        zip.addFile(`process-flows/${id}.json`, Buffer.from(JSON.stringify(doc, null, 2), "utf8"));
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      zip.writeZip(outPath);

      const msg = missing.length > 0
        ? `${outPath} に ${ids.length - missing.length} 件をパック。見つからない ID: ${missing.join(", ")}`
        : `${outPath} に ${ids.length} 件をパックしました。`;
      return { content: [{ type: "text", text: msg }] };
    }

    case "designer__solution_unpack": {
      if (typeof a.inputPath !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "inputPath は必須です");
      }
      const inPath = path.isAbsolute(a.inputPath as string)
        ? (a.inputPath as string)
        : path.join(dataDir(root), a.inputPath as string);
      const conflict = (a.conflictResolution as string | undefined) ?? "skip";

      const zip = new AdmZip(inPath);
      const entries = zip.getEntries().filter(e => e.entryName.startsWith("process-flows/") && e.entryName.endsWith(".json") && !e.isDirectory);

      const actionsDir = path.join(dataDir(root), "actions");
      const results: string[] = [];

      for (const entry of entries) {
        const raw = entry.getData().toString("utf8");
        let doc: Record<string, unknown>;
        try { doc = JSON.parse(raw); } catch { results.push(`SKIP (parse error): ${entry.entryName}`); continue; }

        const id = doc.id as string | undefined;
        if (!id) { results.push(`SKIP (no id): ${entry.entryName}`); continue; }

        const destPath = path.join(actionsDir, `${id}.json`);
        const exists = fs.existsSync(destPath);

        if (exists && conflict === "skip") {
          results.push(`SKIP (exists): ${id}`);
          continue;
        }

        let writeId = id;
        if (exists && conflict === "rename") {
          const prefix = (a.publisherPrefix as string | undefined) ?? "imported";
          writeId = `${prefix}_${id}`;
          doc = { ...doc, id: writeId };
        }

        await writeProcessFlow(writeId, doc, root);
        results.push(`OK: ${writeId}`);
      }

      return { content: [{ type: "text", text: `展開完了 (${results.length} 件):\n${results.join("\n")}` }] };
    }

    // ── 拡張ポイント 専用ツール (#445) ──

    case "designer__add_step_extension": {
      if (typeof a.namespace !== "string" || typeof a.key !== "string" || typeof a.schema !== "object" || a.schema === null || Array.isArray(a.schema)) {
        throw new McpError(ErrorCode.InvalidParams, "namespace, key, schema は必須です");
      }
      const stepsBundle = await readExtensionsBundle(root);
      const rawSteps = stepsBundle.steps;
      const stepsFile = rawSteps && typeof rawSteps === "object" && !Array.isArray(rawSteps)
        ? rawSteps as { namespace?: string; steps?: Record<string, unknown> }
        : { namespace: a.namespace as string, steps: {} };
      const stepsMap: Record<string, unknown> = (stepsFile.steps && typeof stepsFile.steps === "object" && !Array.isArray(stepsFile.steps))
        ? stepsFile.steps as Record<string, unknown>
        : {};
      const stepKey = namespacedKey(a.namespace as string, a.key as string);
      stepsMap[stepKey] = {
        label: typeof a.label === "string" ? a.label : a.key,
        icon: typeof a.icon === "string" ? a.icon : "",
        description: typeof a.description === "string" ? a.description : "",
        schema: a.schema as Record<string, unknown>,
      };
      const newStepsFile = { namespace: typeof stepsFile.namespace === "string" ? stepsFile.namespace : (a.namespace as string), steps: stepsMap };
      try {
        await writeExtensionsFile("steps", newStepsFile, root, {
          onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "steps" } }),
        });
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
      }
      return { content: [{ type: "text", text: `steps.${stepKey} を追加/更新しました。` }] };
    }

    case "designer__add_field_type_extension": {
      if (typeof a.namespace !== "string" || typeof a.kind !== "string" || typeof a.label !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "namespace, kind, label は必須です");
      }
      const ftBundle = await readExtensionsBundle(root);
      const rawFt = ftBundle.fieldTypes;
      const ftFile = rawFt && typeof rawFt === "object" && !Array.isArray(rawFt)
        ? rawFt as { namespace?: string; fieldTypes?: Array<{ kind: string; label: string }> }
        : { namespace: a.namespace as string, fieldTypes: [] };
      const ftArray: Array<{ kind: string; label: string }> = Array.isArray(ftFile.fieldTypes) ? ftFile.fieldTypes as Array<{ kind: string; label: string }> : [];
      const existing = ftArray.findIndex((ft) => ft.kind === a.kind);
      if (existing >= 0) {
        console.warn(`[extensions] fieldTypes.${a.kind} already exists — overwriting`);
        ftArray[existing] = { kind: a.kind as string, label: a.label as string };
      } else {
        ftArray.push({ kind: a.kind as string, label: a.label as string });
      }
      const newFtFile = { namespace: typeof ftFile.namespace === "string" ? ftFile.namespace : (a.namespace as string), fieldTypes: ftArray };
      try {
        await writeExtensionsFile("fieldTypes", newFtFile, root, {
          onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "fieldTypes" } }),
        });
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
      }
      return { content: [{ type: "text", text: `fieldTypes.${a.kind} を追加/更新しました。` }] };
    }

    case "designer__add_trigger_extension": {
      if (typeof a.namespace !== "string" || typeof a.value !== "string" || typeof a.label !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "namespace, value, label は必須です");
      }
      const trBundle = await readExtensionsBundle(root);
      const rawTr = trBundle.triggers;
      const trFile = rawTr && typeof rawTr === "object" && !Array.isArray(rawTr)
        ? rawTr as { namespace?: string; triggers?: Array<{ value: string; label: string }> }
        : { namespace: a.namespace as string, triggers: [] };
      const trArray: Array<{ value: string; label: string }> = Array.isArray(trFile.triggers) ? trFile.triggers as Array<{ value: string; label: string }> : [];
      const existingTr = trArray.findIndex((t) => t.value === a.value);
      if (existingTr >= 0) {
        console.warn(`[extensions] triggers.${a.value} already exists — overwriting`);
        trArray[existingTr] = { value: a.value as string, label: a.label as string };
      } else {
        trArray.push({ value: a.value as string, label: a.label as string });
      }
      const newTrFile = { namespace: typeof trFile.namespace === "string" ? trFile.namespace : (a.namespace as string), triggers: trArray };
      try {
        await writeExtensionsFile("triggers", newTrFile, root, {
          onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "triggers" } }),
        });
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
      }
      return { content: [{ type: "text", text: `triggers.${a.value} を追加/更新しました。` }] };
    }

    case "designer__add_db_operation_extension": {
      if (typeof a.namespace !== "string" || typeof a.value !== "string" || typeof a.label !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "namespace, value, label は必須です");
      }
      const dbBundle = await readExtensionsBundle(root);
      const rawDb = dbBundle.dbOperations;
      const dbFile = rawDb && typeof rawDb === "object" && !Array.isArray(rawDb)
        ? rawDb as { namespace?: string; dbOperations?: Array<{ value: string; label: string }> }
        : { namespace: a.namespace as string, dbOperations: [] };
      const dbArray: Array<{ value: string; label: string }> = Array.isArray(dbFile.dbOperations) ? dbFile.dbOperations as Array<{ value: string; label: string }> : [];
      const existingDb = dbArray.findIndex((d) => d.value === a.value);
      if (existingDb >= 0) {
        console.warn(`[extensions] dbOperations.${a.value} already exists — overwriting`);
        dbArray[existingDb] = { value: a.value as string, label: a.label as string };
      } else {
        dbArray.push({ value: a.value as string, label: a.label as string });
      }
      const newDbFile = { namespace: typeof dbFile.namespace === "string" ? dbFile.namespace : (a.namespace as string), dbOperations: dbArray };
      try {
        await writeExtensionsFile("dbOperations", newDbFile, root, {
          onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "dbOperations" } }),
        });
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
      }
      return { content: [{ type: "text", text: `dbOperations.${a.value} を追加/更新しました。` }] };
    }

    case "designer__remove_extension": {
      const extType = a.type as string | undefined;
      if (!extType || !["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"].includes(extType)) {
        throw new McpError(ErrorCode.InvalidParams, "type は必須です (steps/fieldTypes/triggers/dbOperations/responseTypes)");
      }
      const removeBundle = await readExtensionsBundle(root);
      const rawRemove = removeBundle[extType as ExtensionFileKind];
      if (!rawRemove || typeof rawRemove !== "object" || Array.isArray(rawRemove)) {
        throw new McpError(ErrorCode.InvalidParams, `extensions/${extType} が見つかりません`);
      }
      const removeFile = rawRemove as Record<string, unknown>;

      if (extType === "steps") {
        if (typeof a.key !== "string") throw new McpError(ErrorCode.InvalidParams, "steps の remove には key が必要です");
        const stepsMap = (removeFile.steps && typeof removeFile.steps === "object" && !Array.isArray(removeFile.steps))
          ? { ...(removeFile.steps as Record<string, unknown>) }
          : {};
        const rmKey = namespacedKey(typeof a.namespace === "string" ? a.namespace : "", a.key as string);
        delete stepsMap[rmKey];
        try {
          await writeExtensionsFile("steps", { ...removeFile, steps: stepsMap }, root, {
            onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "steps" } }),
          });
        } catch (e) {
          throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
        }
        return { content: [{ type: "text", text: `steps.${rmKey} を削除しました。` }] };
      } else if (extType === "responseTypes") {
        if (typeof a.key !== "string") throw new McpError(ErrorCode.InvalidParams, "responseTypes の remove には key が必要です");
        const rtMap = (removeFile.responseTypes && typeof removeFile.responseTypes === "object" && !Array.isArray(removeFile.responseTypes))
          ? { ...(removeFile.responseTypes as Record<string, unknown>) }
          : {};
        const rmRtKey = namespacedKey(typeof a.namespace === "string" ? a.namespace : "", a.key as string);
        delete rtMap[rmRtKey];
        try {
          await writeExtensionsFile("responseTypes", { ...removeFile, responseTypes: rtMap }, root, {
            onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "responseTypes" } }),
          });
        } catch (e) {
          throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
        }
        return { content: [{ type: "text", text: `responseTypes.${rmRtKey} を削除しました。` }] };
      } else if (extType === "fieldTypes") {
        if (typeof a.value !== "string") throw new McpError(ErrorCode.InvalidParams, "fieldTypes の remove には value (kind) が必要です");
        const ftArr = Array.isArray(removeFile.fieldTypes) ? (removeFile.fieldTypes as Array<{ kind: string; label: string }>).filter((ft) => ft.kind !== a.value) : [];
        try {
          await writeExtensionsFile("fieldTypes", { ...removeFile, fieldTypes: ftArr }, root, {
            onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "fieldTypes" } }),
          });
        } catch (e) {
          throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
        }
        return { content: [{ type: "text", text: `fieldTypes kind=${a.value} を削除しました。` }] };
      } else if (extType === "triggers") {
        if (typeof a.value !== "string") throw new McpError(ErrorCode.InvalidParams, "triggers の remove には value が必要です");
        const trArr = Array.isArray(removeFile.triggers) ? (removeFile.triggers as Array<{ value: string; label: string }>).filter((t) => t.value !== a.value) : [];
        try {
          await writeExtensionsFile("triggers", { ...removeFile, triggers: trArr }, root, {
            onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "triggers" } }),
          });
        } catch (e) {
          throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
        }
        return { content: [{ type: "text", text: `triggers.${a.value} を削除しました。` }] };
      } else if (extType === "dbOperations") {
        if (typeof a.value !== "string") throw new McpError(ErrorCode.InvalidParams, "dbOperations の remove には value が必要です");
        const dbArr = Array.isArray(removeFile.dbOperations) ? (removeFile.dbOperations as Array<{ value: string; label: string }>).filter((d) => d.value !== a.value) : [];
        try {
          await writeExtensionsFile("dbOperations", { ...removeFile, dbOperations: dbArr }, root, {
            onAfterWrite: () => wsBridge.broadcast({ wsId: root, event: "extensionsChanged", data: { type: "dbOperations" } }),
          });
        } catch (e) {
          throw new McpError(ErrorCode.InvalidParams, e instanceof Error ? e.message : String(e));
        }
        return { content: [{ type: "text", text: `dbOperations.${a.value} を削除しました。` }] };
      }
      return { content: [{ type: "text", text: "削除完了。" }] };
    }

    case "designer__list_extensions": {
      const allBundle = await readExtensionsBundle(root);
      return { content: [{ type: "text", text: JSON.stringify(allBundle, null, 2) }] };
    }

    default:
      return null;
  }
};

// ---- Arazzo export helpers ----

interface ArazzoStep {
  stepId: string;
  operationId?: string;
  operationPath?: string;
  successCriteria?: unknown[];
}

interface ArazzoDoc {
  arazzo: string;
  info: { title: string; version: string };
  sourceDescriptions: Array<{ name: string; url: string; type: string }>;
  workflows: Array<{ workflowId: string; steps: ArazzoStep[] }>;
}

function collectNestedStepLists(s: Record<string, unknown>): Array<unknown[]> {
  const lists: Array<unknown[]> = [];
  const push = (v: unknown) => { if (Array.isArray(v)) lists.push(v as unknown[]); };
  // branch / loop / transactionScope / workflow inner steps
  push(s.steps);
  push(s.subSteps);
  push(s.onCommit);    // TransactionScopeStep
  push(s.onRollback);  // TransactionScopeStep
  push(s.onApproved);  // WorkflowStep
  push(s.onRejected);  // WorkflowStep
  push(s.onTimeout);   // WorkflowStep
  // branches
  if (Array.isArray(s.branches)) {
    for (const b of s.branches as Array<{ steps?: unknown[] }>) push(b.steps);
  }
  if (s.elseBranch) push((s.elseBranch as { steps?: unknown[] }).steps);
  // ExternalCallOutcomeSpec sideEffects
  if (s.outcomes && typeof s.outcomes === "object") {
    for (const oc of Object.values(s.outcomes as Record<string, { sideEffects?: unknown[] }>)) {
      if (oc && Array.isArray(oc.sideEffects)) lists.push(oc.sideEffects);
    }
  }
  return lists;
}

function collectExternalSteps(steps: unknown[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const step of steps) {
    const s = step as Record<string, unknown>;
    if (s.type === "externalSystem") result.push(s);
    for (const nested of collectNestedStepLists(s)) {
      result.push(...collectExternalSteps(nested));
    }
  }
  return result;
}

function buildArazzoDoc(flow: Record<string, unknown>): ArazzoDoc {
  const flowId = flow.id as string;
  const flowName = flow.name as string ?? flowId;
  const catalog = (flow.externalSystemCatalog ?? {}) as Record<string, Record<string, unknown>>;

  const allSteps: Array<Record<string, unknown>> = [];
  for (const action of (flow.actions ?? []) as Array<{ steps?: unknown[] }>) {
    if (Array.isArray(action.steps)) allSteps.push(...collectExternalSteps(action.steps));
  }

  const seenSystems = new Map<string, string>();
  for (const step of allSteps) {
    const sysRef = step.systemRef as string | undefined;
    const sysName = step.systemName as string | undefined;
    const key = sysRef ?? sysName ?? "unknown";
    if (!seenSystems.has(key)) {
      const entry = sysRef ? catalog[sysRef] : undefined;
      const url = (entry?.openApiSpec as string | undefined) ?? "#unknown";
      seenSystems.set(key, url);
    }
  }

  const sourceDescriptions = Array.from(seenSystems.entries()).map(([name, url]) => ({
    name,
    url,
    type: "openapi",
  }));

  const arazzoSteps: ArazzoStep[] = allSteps.map(step => {
    const s: ArazzoStep = { stepId: step.id as string };
    if (step.operationId) s.operationId = step.operationId as string;
    else if (step.operationRef) s.operationPath = step.operationRef as string;
    else if (step.httpCall) {
      const hc = step.httpCall as { method?: string; path?: string };
      s.operationPath = `${hc.method ?? "POST"} ${hc.path ?? "/"}`;
    }
    if (Array.isArray(step.successCriteria) && step.successCriteria.length > 0) {
      s.successCriteria = step.successCriteria;
    }
    return s;
  });

  return {
    arazzo: "1.0.1",
    info: { title: flowName, version: "1.0" },
    sourceDescriptions,
    workflows: [{ workflowId: flowId, steps: arazzoSteps }],
  };
}

function toYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    const needsQuote =
      /[\n:#{}\[\],&*?|<>=!%@`]/.test(obj) ||
      obj.trim() !== obj ||
      /^(true|false|null|~|yes|no|on|off)$/i.test(obj) ||
      /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(obj);
    if (needsQuote) {
      return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map(item => `\n${pad}- ${toYaml(item, indent + 1).trimStart()}`).join("");
  }
  const entries = Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  return entries
    .map(([k, v]) => {
      const valStr = toYaml(v, indent + 1);
      // non-empty objects/arrays: valStr starts with \n — omit space (key:\n  ...)
      // empty or scalar: valStr does not start with \n — add space (key: value)
      const sep = valStr.startsWith("\n") ? "" : " ";
      return `\n${pad}${k}:${sep}${valStr}`;
    })
    .join("");
}
