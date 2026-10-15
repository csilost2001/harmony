/** 運用の記録 (体裁・承認・コメント・権限・生成の記録) の問題を、設計の「要確認」に足す */
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalForHash, effectiveStatus, OPS_ENTITY_LABELS, OPS_ENTITY_KINDS, type OpsEntityKind } from "@harmony/shared";
import { memoizeBySignature } from "../dataSignature.js";
import type { SchemaIssue } from "../schemaIssues.js";
import { resolveDataRoot } from "../storageCore.js";
import { sha256 } from "./entityHash.js";
import { accessStore, approvalsStore, commentsStore, generationStore, notifyStore, templateStore } from "./stores.js";

const DIRS: Record<OpsEntityKind, string> = { screen: "screens", table: "tables", processFlow: "process-flows", businessFlow: "business-flows", report: "reports", sequence: "sequences", view: "views", viewDefinition: "view-definitions" };

async function computePolicyIssues(root: string): Promise<SchemaIssue[]> {
  const access = (await accessStore.read(root)).value;
  if (!access.policy.requireApprovalForCommitted) return [];
  const approvals = (await approvalsStore.read(root)).value;
  const dataRoot = await resolveDataRoot(root);
  const out: SchemaIssue[] = [];
  for (const kind of OPS_ENTITY_KINDS) {
    let files: string[] = [];
    try { files = (await fs.readdir(path.join(dataRoot, DIRS[kind]))).filter((f) => f.endsWith(".json") && !f.endsWith(".design.json") && !f.startsWith(".")); } catch { continue; }
    for (const f of files) {
      let j: Record<string, unknown>;
      try { j = JSON.parse(await fs.readFile(path.join(dataRoot, DIRS[kind], f), "utf-8")) as Record<string, unknown>; } catch { continue; }
      const meta = (j.meta && typeof j.meta === "object" ? j.meta : j) as Record<string, unknown>;
      if ((j.maturity ?? meta.maturity) !== "committed") continue;
      const id = f.slice(0, -5);
      const status = effectiveStatus(approvals.items.find((a) => a.kind === kind && a.id === id), sha256(canonicalForHash(j)));
      if (status === "approved") continue;
      const name = typeof meta.name === "string" ? meta.name : id;
      out.push({
        severity: "warning", section: `${OPS_ENTITY_LABELS[kind]} ${name}`,
        message: status === "stale" ? "確定 (committed) ですが、承認のあとに内容が変わっています。もう一度承認を受けてください" : "確定 (committed) ですが、承認されていません。承認を受けてください",
        ...(kind === "screen" || kind === "table" || kind === "processFlow" ? { ref: { kind, id } } : {}),
      });
    }
  }
  return out;
}
const policyIssues = memoizeBySignature(computePolicyIssues);

export async function collectOpsIssues(root: string): Promise<SchemaIssue[]> {
  const problems = (await Promise.all([templateStore, approvalsStore, commentsStore, accessStore, generationStore, notifyStore].map((s) => s.read(root).then((r) => r.problems, () => [] as string[])))).flat();
  return [...problems.map((message): SchemaIssue => ({ severity: "warning", section: "読み込み", message })), ...await policyIssues(root).catch(() => [])];
}
