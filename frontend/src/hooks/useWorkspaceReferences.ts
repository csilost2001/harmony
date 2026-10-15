/**
 * ワークスペース全体の参照情報を一括ロードする hook (Phase 2 / #1255)。
 *
 * useProcessFlowCatalogs.ts のパターンを参考に、補完用に必要な
 * screens / tables / viewDefinitions / processFlows /
 * components / exceptionTypes / modelEndpoints / secrets / events
 * を取得する。
 */

import { useState, useEffect, useCallback } from "react";
import { loadProject } from "../store/flowStore";
import { loadAllTables } from "../store/tableStore";
import { listViewDefinitions } from "../store/viewDefinitionStore";
import { listGenericDefinitions } from "../store/genericDefinitionStore";
import { loadAllProcessFlows, loadProcessFlow } from "../store/processFlowStore";
import type { ProcessFlow } from "../types/v3";
import { mcpBridge } from "../mcp/mcpBridge";
import type { WorkspaceRefs } from "../utils/reference-completer/types";
import type { ProjectCatalogs } from "../schemas/projectCatalogs";

export type { WorkspaceRefs };

function emptyRefs(): WorkspaceRefs {
  return {
    screens: [],
    tables: [],
    viewDefinitions: [],
    processFlows: [],
    components: [],
    exceptionTypes: [],
    modelEndpoints: [],
    secrets: [],
    events: [],
  };
}

/**
 * ワークスペース全体の参照情報を取得する hook。
 * mount 時に一度だけロードし、結果を state として保持する。
 */
export function useWorkspaceReferences(): WorkspaceRefs {
  const [refs, setRefs] = useState<WorkspaceRefs>(emptyRefs);

  const load = useCallback(() => {
    (async () => {
      const [projectResult, tablesResult, viewDefsResult, componentsResult, exceptionsResult, catalogsResult] =
        await Promise.allSettled([
          loadProject(),
          loadAllTables(),
          listViewDefinitions(),
          listGenericDefinitions("component-definition"),
          listGenericDefinitions("exception-type"),
          mcpBridge.request("loadProjectCatalogs").catch(() => null),
        ]);

      const projectData = projectResult.status === "fulfilled" ? projectResult.value : null;
      const tablesData = tablesResult.status === "fulfilled" ? tablesResult.value : [];
      const viewDefsData = viewDefsResult.status === "fulfilled" ? viewDefsResult.value : [];
      const componentsData = componentsResult.status === "fulfilled" ? componentsResult.value : [];
      const exceptionsData = exceptionsResult.status === "fulfilled" ? exceptionsResult.value : [];
      const projectCatalogs = (catalogsResult.status === "fulfilled" ? catalogsResult.value : null) as ProjectCatalogs | null;

      // processFlows は loadProject から meta 情報を取得
      // actions は各 ProcessFlow を parallel ロードして取得 (#1260 D)
      const processFlowMetas = projectData?.processFlows ?? [];

      // actions[] を eager parallel preload する
      // 1 回の問い合わせでまとめて読む (1 件ずつ尋ねない)
      // 一括読みに失敗したら、従来どおり 1 件ずつ読む (全部が「actions なし」になって黙って見えなくなるのを避ける)
      const allFlows = await loadAllProcessFlows().catch(async () => {
        const each = await Promise.allSettled(processFlowMetas.map((m) => loadProcessFlow(m.id as unknown as string)));
        return new Map<string, ProcessFlow>(each.flatMap((r, i) => (r.status === "fulfilled" && r.value ? [[processFlowMetas[i].id as unknown as string, r.value] as [string, ProcessFlow]] : [])));
      });
      const actionsResults: PromiseSettledResult<ProcessFlow | null>[] = processFlowMetas.map((m) => ({ status: "fulfilled" as const, value: allFlows.get(m.id as unknown as string) ?? null }));

      setRefs({
        screens: (projectData?.screens ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          maturity: s.maturity,
        })),
        tables: tablesData.map((t) => ({
          id: t.id,
          physicalName: t.physicalName ?? "",
          name: t.name,
          maturity: t.maturity,
          columns: (t.columns ?? []).map((c) => ({
            physicalName: c.physicalName,
            name: c.name,
            dataType: c.dataType,
            length: c.length,
            primaryKey: c.primaryKey,
            notNull: c.notNull,
          })),
        })),
        viewDefinitions: viewDefsData.map((v) => ({
          id: v.id as unknown as string,
          name: v.name,
          maturity: v.maturity,
        })),
        processFlows: processFlowMetas.map((f, idx) => {
          const result = actionsResults[idx];
          const loaded = result.status === "fulfilled" ? result.value : null;
          return {
            id: f.id as unknown as string,
            name: f.name,
            kind: f.flowType ?? "other",
            maturity: f.maturity,
            actions: loaded?.actions?.map((a) => ({ id: a.id as unknown as string, name: a.name })),
          };
        }),
        components: componentsData.map((d) => ({ name: d.name })),
        exceptionTypes: exceptionsData.map((d) => ({ name: d.name })),
        modelEndpoints: Object.keys(projectCatalogs?.modelEndpoints ?? {}).map((id) => ({
          id,
          name: id,
        })),
        secrets: Object.keys(projectCatalogs?.secrets ?? {}).map((id) => ({
          id,
          name: id,
        })),
        events: Object.keys(projectCatalogs?.events ?? {}).map((topic) => ({
          topic,
        })),
      });
    })().catch(() => {
      // ロード失敗時は空のまま (UI は degraded state で動作継続)
    });
  }, []);

  useEffect(() => {
    load();
    const unsub = mcpBridge.onBroadcast("processFlowChanged", load);
    return unsub;
  }, [load]);

  return refs;
}
