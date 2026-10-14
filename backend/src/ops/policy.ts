/**
 * 権限と承認の方針の実施。
 * - 役割 (access.json): 設定があるとき、編集の操作は「編集」以上、承認は「承認」以上、設定の変更は「管理」。AI (MCP) の操作は対象外 (AI の権限は HARMONY_MCP_MODE / HARMONY_MCP_DENY)
 * - 承認の方針 (access.json の policy.requireApprovalForCommitted): 確定 (maturity: committed) の保存には、承認済みで内容が変わっていないことが必要
 *   (保存を担う writeJSON の直前の検査として入れるので、画面・AI のどちらの書き込みにも効く)
 * 設定ファイルは、更新時刻が変わらないあいだ読み直さない。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalForHash, can, cleanActor, emptyAccess, parseAccess, roleOf, ROLE_LABELS, type AccessFile, type ApprovalsFile, type OpsEntityKind, type Role, parseApprovals, emptyApprovals } from "@harmony/shared";
import { sha256 } from "./entityHash.js";
import { findWorkspaceRoot } from "../fileBackup.js";
import { addPreWriteGuard, resolveDataRoot } from "../storageCore.js";

const cache = new Map<string, { sig: string; value: unknown }>();
async function readCached<T>(file: string, parse: (raw: unknown) => T, empty: T): Promise<T> {
  let sig: string;
  try { const st = await fs.stat(file); sig = `${st.size}:${st.mtimeMs}`; } catch { return empty; }
  const hit = cache.get(file);
  if (hit && hit.sig === sig) return hit.value as T;
  let value = empty;
  try { value = parse(JSON.parse(await fs.readFile(file, "utf-8"))); } catch { /* 読めなければ、制限しない (壊れた設定で、保存まで止めない。壊れていることは、点検が知らせる) */ }
  cache.set(file, { sig, value });
  return value;
}

export async function loadAccess(root: string): Promise<AccessFile> {
  const dataRoot = await resolveDataRoot(root).catch(() => null);
  if (!dataRoot) return emptyAccess();
  return readCached(path.join(dataRoot, "access.json"), (raw) => parseAccess(raw).value, emptyAccess());
}
export async function loadApprovals(root: string): Promise<ApprovalsFile> {
  const dataRoot = await resolveDataRoot(root).catch(() => null);
  if (!dataRoot) return emptyApprovals();
  return readCached(path.join(dataRoot, "approvals.json"), (raw) => parseApprovals(raw).value, emptyApprovals());
}

export class PermissionError extends Error {}

/** その操作に必要な役割が無ければ、日本語の理由つきで拒否する */
export async function requireRole(root: string, actor: string, need: Role, what: string): Promise<void> {
  const access = await loadAccess(root);
  if (can(access, actor, need)) return;
  const mine = roleOf(access, actor);
  throw new PermissionError(`${what}には、「${ROLE_LABELS[need]}」以上の役割が必要です (${cleanActor(actor) ? `「${cleanActor(actor)}」は${mine ? `「${ROLE_LABELS[mine]}」` : "役割が登録されていません"}` : "利用者名が未設定です。設定してください"})`);
}

/** 書き込みの RPC (編集の操作)。これらは「編集」以上の役割が要る */
export const EDIT_RPC = /^(save[A-Z]|delete[A-Z]|rename[A-Z]|undoEntityRename|designReplace\.(apply|undo)|editSession\.(create|save)|workspace\.(persistUuids|repairRegistry))/;
export const isEditRpc = (method: string): boolean => EDIT_RPC.test(method) && method !== "saveErLayout" && method !== "saveScreenFlowPositions";

// ── 承認の方針 ─────────────────────────────────────────────────────────────

const DIR_KIND: Array<[string, OpsEntityKind]> = [["screens", "screen"], ["tables", "table"], ["process-flows", "processFlow"], ["actions", "processFlow"], ["business-flows", "businessFlow"], ["reports", "report"], ["sequences", "sequence"], ["views", "view"], ["view-definitions", "viewDefinition"]];

/** データフォルダの中の設計のファイルなら、その種類と id */
export function entityOfPath(dataRoot: string, filePath: string): { kind: OpsEntityKind; id: string } | null {
  const rel = path.relative(dataRoot, filePath).split(path.sep);
  if (rel.length !== 2 || !rel[1].endsWith(".json") || rel[1].endsWith(".design.json") || rel[1].startsWith(".")) return null;
  const hit = DIR_KIND.find(([d]) => d === rel[0]);
  return hit ? { kind: hit[1], id: rel[1].slice(0, -5) } : null;
}

const maturityOf = (data: unknown): unknown => {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  return d.maturity ?? (d.meta && typeof d.meta === "object" ? (d.meta as Record<string, unknown>).maturity : undefined);
};

/** 承認が要るのに、承認されていない保存なら、理由を返す (null = 保存してよい) */
export function violatesApprovalPolicy(access: AccessFile, approvals: ApprovalsFile, kind: OpsEntityKind, id: string, data: unknown): string | null {
  if (!access.policy.requireApprovalForCommitted || maturityOf(data) !== "committed") return null;
  const a = approvals.items.find((x) => x.kind === kind && x.id === id);
  if (!a || a.state !== "approved" || !a.hash) return "確定 (committed) にするには、承認が必要です。「連携と運用」の「レビューと承認」で、承認を受けてください";
  if (a.hash !== sha256(canonicalForHash(data))) return "承認のあとに内容が変わっています。確定のままにするには、もう一度承認を受けてください (または、成熟度を下書き / 暫定に戻してください)";
  return null;
}

let installed = false;
export function installApprovalGuard(): void {
  if (installed) return;
  installed = true;
  addPreWriteGuard(async (filePath, data) => {
    const ws = await findWorkspaceRoot(filePath);
    if (!ws) return;
    const dataRoot = await resolveDataRoot(ws).catch(() => null);
    if (!dataRoot) return;
    const ent = entityOfPath(dataRoot, path.resolve(filePath));
    if (!ent) return;
    const access = await loadAccess(ws);
    if (!access.policy.requireApprovalForCommitted) return;
    const why = violatesApprovalPolicy(access, await loadApprovals(ws), ent.kind, ent.id, data);
    if (why) throw new PermissionError(`${ent.id}: ${why}`);
  });
}
