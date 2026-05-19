// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-3 (#1145): ProcessFlowEditor.tsx の各種カタログ (tables / screens / commonGroups /
// conventions / extensions / genericDefNames / projectCatalogs) ロード処理を集約したフック。
// handleLoaded から呼び出される一括 fetch を含む。
//
// 役割:
// - ProcessFlow ロード時にプロジェクト全体のカタログを一度に取得 (load 関数を返す)
// - mcpBridge.onExtensionsChanged 監視で extensions を auto-refresh

import { useEffect, useState } from "react";
import type { ProcessFlow } from "../../../types/v3";
import { listTables, loadTable } from "../../../store/tableStore";
import { loadProject } from "../../../store/flowStore";
import type { TableDefinition as ValidatorTableDef } from "../../../schemas/sqlColumnValidator";
import type { ConventionsCatalog } from "../../../schemas/conventionsValidator";
import type { GenericDefinitionNames } from "../../../schemas/referentialIntegrity";
import type { ProjectCatalogs } from "../../../schemas/projectCatalogs";
import { loadExtensionsFromBundle, type LoadedExtensions } from "../../../schemas/loadExtensions";
import { loadConventions } from "../../../store/conventionsStore";
import { listGenericDefinitions } from "../../../store/genericDefinitionStore";
import { mcpBridge } from "../../../mcp/mcpBridge";

export interface ProcessFlowCatalogs {
  tables: { id: string; physicalName: string; name: string }[];
  screens: { id: string; name: string }[];
  commonGroups: { id: string; name: string }[];
  tableDefs: ValidatorTableDef[];
  conventions: ConventionsCatalog | null;
  extensions: LoadedExtensions | undefined;
  genericDefNames: GenericDefinitionNames;
  projectCatalogs: ProjectCatalogs | null;
  /** loadProcessFlow の onLoaded コールバックから呼んで全カタログを一括ロードする */
  loadAll: (g: ProcessFlow) => void;
}

export function useProcessFlowCatalogs(): ProcessFlowCatalogs {
  const [tables, setTables] = useState<{ id: string; physicalName: string; name: string }[]>([]);
  const [screens, setScreens] = useState<{ id: string; name: string }[]>([]);
  const [commonGroups, setCommonGroups] = useState<{ id: string; name: string }[]>([]);
  const [tableDefs, setTableDefs] = useState<ValidatorTableDef[]>([]);
  const [conventions, setConventions] = useState<ConventionsCatalog | null>(null);
  const [extensions, setExtensions] = useState<LoadedExtensions | undefined>(undefined);
  const [genericDefNames, setGenericDefNames] = useState<GenericDefinitionNames>({});
  const [projectCatalogs, setProjectCatalogs] = useState<ProjectCatalogs | null>(null);

  const loadAll = (_g: ProcessFlow) => {
    loadProject()
      .then((p) => {
        setScreens(p.screens.map((s) => ({ id: s.id, name: s.name })));
        const agMetas = p.processFlows ?? [];
        setCommonGroups(
          agMetas.filter((a) => a.kind === "common").map((a) => ({ id: a.id, name: a.name })),
        );
      })
      .catch(console.error);
    listTables()
      .then(async (metas) => {
        setTables(
          metas.map((tm) => ({ id: tm.id, physicalName: tm.physicalName ?? "", name: tm.name })),
        );
        const defs = await Promise.all(
          metas.map(async (tm) => {
            const full = await loadTable(tm.id);
            if (!full) return null;
            return {
              id: full.id,
              name: full.physicalName,
              columns: (full.columns ?? []).map((c) => ({ name: c.physicalName })),
            } as ValidatorTableDef;
          }),
        );
        setTableDefs(defs.filter((d): d is ValidatorTableDef => d !== null));
      })
      .catch(console.error);
    loadConventions()
      .then((c) => setConventions(c as ConventionsCatalog | null))
      .catch(() => setConventions(null));
    mcpBridge
      .request("loadProjectCatalogs")
      .then((c) => setProjectCatalogs(c as ProjectCatalogs | null))
      .catch(() => setProjectCatalogs(null));
    mcpBridge
      .getExtensions()
      .then((bundle) => setExtensions(loadExtensionsFromBundle(bundle).extensions))
      .catch(() => setExtensions(undefined));
    Promise.all([
      listGenericDefinitions("component-definition").catch(() => []),
      listGenericDefinitions("exception-type").catch(() => []),
    ]).then(([components, exceptions]) => {
      setGenericDefNames({
        "component-definition": new Set(components.map((c) => c.name)),
        "exception-type": new Set(exceptions.map((e) => e.name)),
      });
    });
  };

  // Extensions の auto-refresh
  useEffect(() => {
    return mcpBridge.onExtensionsChanged(() => {
      mcpBridge
        .getExtensions(true)
        .then((bundle) => setExtensions(loadExtensionsFromBundle(bundle).extensions))
        .catch(() => setExtensions(undefined));
    });
  }, []);

  return {
    tables,
    screens,
    commonGroups,
    tableDefs,
    conventions,
    extensions,
    genericDefNames,
    projectCatalogs,
    loadAll,
  };
}
