/**
 * 操作単位の権限。役割 × 画面 × 操作 (処理フローのアクション) のマトリクスと、「権限が決まっていない更新操作」の検出。
 * 画面に必要な権限と、操作に必要な権限は、どちらも満たす必要がある (AND)。要求が無ければ誰でも使える。
 * 規約の役割・権限と、画面の `permissions`・アクションの `requiredPermissions` から導く (新しいスキーマは要らない)。
 */
import type { DesignDocInput, DocIssue } from "../designDocument.js";
import { effectivePermissions, normalizePermissionKey } from "../accessMatrix.js";
import { forEachStep, opLetters, toCsv } from "./common.js";

export interface OperationRow {
  screen: { id: string; name: string } | null;
  flow: { id: string; name: string };
  action: { id: string; name: string };
  http?: { method: string; path: string };
  /** 更新系 (登録・更新・削除) の DB アクセスを含む */
  writes: boolean;
  writtenTables: string[];
  screenPermissions: string[];
  actionPermissions: string[];
  /** この操作を使える役割 */
  roles: string[];
  open: boolean;
}

export interface OperationMatrix { roleIds: string[]; rows: OperationRow[]; issues: DocIssue[] }

const HTTP_WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function deriveOperationMatrix(input: DesignDocInput): OperationMatrix {
  const roles = input.roles ?? {};
  const { effective } = effectivePermissions(roles);
  const roleIds = Object.keys(roles);
  const screens = new Map(input.screens.map((s) => [s.id, s]));
  const rows: OperationRow[] = [];
  const issues: DocIssue[] = [];

  const screensOfFlow = (flowId: string, screenId?: string): string[] => {
    const ids = new Set<string>();
    if (screenId && screens.has(screenId)) ids.add(screenId);
    for (const s of input.screens) for (const it of s.items ?? []) for (const e of it.events ?? []) if (e.handlerFlowId === flowId) ids.add(s.id);
    return [...ids];
  };

  for (const f of input.flows) {
    for (const [ai, a] of f.actions.entries()) {
      const written = new Set<string>();
      forEachStep(a.steps, (st) => {
        const x = st as Record<string, unknown>;
        if (st.kind === "dbAccess" && typeof x.tableId === "string" && opLetters(String(x.operation ?? "")).some((l) => l !== "R")) written.add(x.tableId);
      });
      const http = a.httpRoute?.method && a.httpRoute.path ? { method: a.httpRoute.method, path: a.httpRoute.path } : undefined;
      const writes = written.size > 0 || (!!http && HTTP_WRITE.has(http.method));
      const actionPerms = [...new Set((a.requiredPermissions ?? []).map(normalizePermissionKey))];
      const owners = screensOfFlow(f.meta.id, f.meta.screenId);
      const subjects: Array<{ id: string; name: string; perms: string[] } | null> = owners.length
        ? owners.map((id) => { const s = screens.get(id)!; return { id, name: s.name ?? id, perms: [...new Set((s.permissions ?? []).map(normalizePermissionKey))] }; })
        : [null];
      for (const sub of subjects) {
        const need = [...new Set([...(sub?.perms ?? []), ...actionPerms])];
        rows.push({
          screen: sub ? { id: sub.id, name: sub.name } : null,
          flow: { id: f.meta.id, name: f.meta.name ?? f.meta.id },
          action: { id: a.id ?? `action${ai + 1}`, name: a.name ?? a.id ?? `アクション ${ai + 1}` },
          ...(http ? { http } : {}),
          writes, writtenTables: [...written],
          screenPermissions: sub?.perms ?? [], actionPermissions: actionPerms,
          roles: roleIds.filter((r) => need.every((p) => effective[r]?.includes(p))),
          open: need.length === 0,
        });
        // 権限が決まっていない更新操作: 画面の権限でも操作の権限でも守られていない
        if (writes && need.length === 0) {
          issues.push({
            severity: "warning",
            section: `処理フロー ${f.meta.name ?? f.meta.id}`,
            message: `更新を伴う操作「${a.name ?? a.id ?? `アクション ${ai + 1}`}」${sub ? `(画面「${sub.name}」)` : http ? `(${http.method} ${http.path})` : ""}に、必要な権限が決まっていません (誰でも実行できます)`,
            ref: { kind: "processFlow", id: f.meta.id },
          });
        }
      }
    }
  }
  return { roleIds, rows, issues };
}

/** 権限の定義が (1 つでも) あるプロジェクトか。無いプロジェクトでは、「権限が無い操作」を指摘しない */
export function usesPermissionModel(input: DesignDocInput): boolean {
  return Object.keys(input.roles ?? {}).length > 0 || Object.keys(input.permissions ?? {}).length > 0
    || input.screens.some((s) => (s.permissions ?? []).length > 0) || input.flows.some((f) => f.actions.some((a) => (a.requiredPermissions ?? []).length > 0));
}

export function operationMatrixToCsv(m: OperationMatrix, roleName: (id: string) => string): string {
  return toCsv(
    ["画面", "処理フロー", "操作", "HTTP", "更新", "画面の権限", "操作の権限", ...m.roleIds.map(roleName)],
    m.rows.map((r) => [r.screen?.name ?? "", r.flow.name, r.action.name, r.http ? `${r.http.method} ${r.http.path}` : "", r.writes ? "○" : "", r.screenPermissions.join("、"), r.actionPermissions.join("、"), ...m.roleIds.map((id) => (r.roles.includes(id) ? "○" : ""))]),
  );
}
