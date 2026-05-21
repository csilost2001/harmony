/**
 * ワークスペース全体の参照情報を一括ロードする hook (Phase 2 / #1255)。
 *
 * useProcessFlowCatalogs.ts のパターンを参考に、補完用に必要な
 * screens / tables / viewDefinitions / processFlows / fragments /
 * components / exceptionTypes / modelEndpoints / secrets / events
 * を取得する。
 */

import { useState, useEffect, useCallback } from "react";
import { loadProject } from "../store/flowStore";
import { listTables } from "../store/tableStore";
import { listViewDefinitions } from "../store/viewDefinitionStore";
import { listGenericDefinitions } from "../store/genericDefinitionStore";
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
    fragments: [],
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
    Promise.allSettled([
      loadProject(),
      listTables(),
      listViewDefinitions(),
      listGenericDefinitions("ui-fragment"),
      listGenericDefinitions("component-definition"),
      listGenericDefinitions("exception-type"),
      mcpBridge.request("loadProjectCatalogs").catch(() => null),
    ]).then(
      ([projectResult, tablesResult, viewDefsResult, fragmentsResult, componentsResult, exceptionsResult, catalogsResult]) => {
        const projectData = projectResult.status === "fulfilled" ? projectResult.value : null;
        const tablesData = tablesResult.status === "fulfilled" ? tablesResult.value : [];
        const viewDefsData = viewDefsResult.status === "fulfilled" ? viewDefsResult.value : [];
        const fragmentsData = fragmentsResult.status === "fulfilled" ? fragmentsResult.value : [];
        const componentsData = componentsResult.status === "fulfilled" ? componentsResult.value : [];
        const exceptionsData = exceptionsResult.status === "fulfilled" ? exceptionsResult.value : [];
        const projectCatalogs = (catalogsResult.status === "fulfilled" ? catalogsResult.value : null) as ProjectCatalogs | null;

        // processFlows は loadProject から meta 情報を取得
        // actions は ProcessFlow を個別ロードしないと取れないため meta のみ
        const processFlowMetas = projectData?.processFlows ?? [];

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
          })),
          viewDefinitions: viewDefsData.map((v) => ({
            id: v.id as unknown as string,
            name: v.name,
            maturity: v.maturity,
          })),
          processFlows: processFlowMetas.map((f) => ({
            id: f.id as unknown as string,
            name: f.name,
            kind: f.kind ?? "other",
            maturity: f.maturity,
            // actions: ProcessFlowMeta には actions がないため省略
            actions: undefined,
          })),
          fragments: fragmentsData.map((d) => ({ name: d.name })),
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
      },
    ).catch(() => {
      // ロード失敗時は空のまま (UI は degraded state で動作継続)
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return refs;
}
