// Phase-3 (#1145): ProcessFlowEditor.tsx の各種カタログ (tables / screens / commonGroups /
// conventions / extensions / genericDefNames / projectCatalogs) ロード処理を集約したフック。
// handleLoaded から呼び出される一括 fetch を含む。
//
// 役割:
// - ProcessFlow ロード時にプロジェクト全体のカタログを一度に取得 (load 関数を返す)
// - mcpBridge.onExtensionsChanged 監視で extensions を auto-refresh

import { useEffect, useState } from "react";
import type { ProcessFlow } from "../../../types/v3";
import { listTables, loadAllTables } from "../../../store/tableStore";
import { loadProject } from "../../../store/flowStore";
import type { TableDefinition as ValidatorTableDef } from "../../../schemas/sqlColumnValidator";
import type { ConventionsCatalog } from "../../../schemas/conventionsValidator";
import type { GenericDefinitionNames } from "../../../schemas/referentialIntegrity";
import type { ProjectCatalogs } from "../../../schemas/projectCatalogs";
import { loadExtensionsFromBundle, type LoadedExtensions } from "../../../schemas/loadExtensions";
import { loadConventions } from "../../../store/conventionsStore";
import { listGenericDefinitions } from "../../../store/genericDefinitionStore";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { reportFailure } from "../../../utils/failureToast";

/**
 * テーブルの、1 行を決める列の組 (物理名)。単一列の主キー (`Column.primaryKey`)・複合主キー (`kind: "primaryKey"` の制約)・単独の一意列・一意制約・一意インデックス。
 * 部分インデックス (`where` つき) は、その条件の中でしか一意でないので、数えない。空なら、決める列が分からないので undefined
 */
export function uniqueKeysOf(t: {
  columns?: Array<{ id?: string; physicalName?: string; primaryKey?: boolean; unique?: boolean }>;
  constraints?: Array<{ kind?: string; columnIds?: string[] }>;
  indexes?: Array<{ unique?: boolean; where?: string; columns?: Array<{ columnId?: string }> }>;
}): string[][] | undefined {
  const cols = t.columns ?? [];
  const name = (id: string | undefined) => cols.find((c) => c.id === id)?.physicalName;
  const keys: string[][] = [];
  const pk = cols.filter((c) => c.primaryKey && c.physicalName).map((c) => c.physicalName as string);
  if (pk.length > 0) keys.push(pk);
  for (const c of cols) if (c.unique && c.physicalName) keys.push([c.physicalName]);
  const fromIds = (ids: Array<string | undefined>) => { const k = ids.map(name).filter((x): x is string => Boolean(x)); if (k.length > 0 && k.length === ids.length) keys.push(k); };
  for (const c of t.constraints ?? []) if (c.kind === "unique" || c.kind === "primaryKey") fromIds(c.columnIds ?? []);
  for (const i of t.indexes ?? []) if (i.unique && !i.where) fromIds((i.columns ?? []).map((x) => x.columnId));
  return keys.length > 0 ? keys : undefined;
}

export interface ProcessFlowCatalogs {
  tables: { id: string; physicalName: string; name: string; /** 1 行を決める列の組 (主キー・一意。物理名) */ uniqueKeys?: string[][] }[];
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
  const [tables, setTables] = useState<ProcessFlowCatalogs["tables"]>([]);
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
          agMetas.filter((a) => a.flowType === "common").map((a) => ({ id: a.id, name: a.name })),
        );
      })
      .catch((err) => reportFailure(err, "処理フローの参照先の読み込み"));
    listTables()
      .then(async (metas) => {
        setTables((prev) => metas.map((tm) => ({ id: tm.id, physicalName: tm.physicalName ?? "", name: tm.name, uniqueKeys: prev.find((p) => p.id === tm.id)?.uniqueKeys })));
        // 全テーブルを 1 回の問い合わせでまとめて読む (1 件ずつ尋ねない)
        const all = await loadAllTables();
        const defs = all.map((full) => ({
          id: full.id,
          name: full.physicalName,
          columns: (full.columns ?? []).map((c) => ({ name: c.physicalName })),
        } as ValidatorTableDef));
        setTableDefs(defs);
        // 検索の結果が 1 件か一覧かの推定に使う: 1 行を決める列 (主キー・単独の一意列・一意制約・一意インデックス)
        const keys = new Map(all.map((full) => [String(full.id), uniqueKeysOf(full as unknown as Parameters<typeof uniqueKeysOf>[0])] as const));
        setTables((prev) => prev.map((t) => ({ ...t, uniqueKeys: keys.get(String(t.id)) })));
      })
      .catch((err) => reportFailure(err, "処理フローの参照先の読み込み"));
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
