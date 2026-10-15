/** 設計 1 件の、内容の印 (hash)。承認の「承認後に変更されたか」と、生成の記録の「設計が変わったか」に使う */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalForHash, isOpsEntityKind, type OpsEntityKind } from "@harmony/shared";
import { assertSafeName } from "../security/idValidator.js";
import { resolveDataRoot } from "../storageCore.js";

const DIRS: Record<OpsEntityKind, string[]> = {
  screen: ["screens"], table: ["tables"], processFlow: ["process-flows", "actions"], businessFlow: ["business-flows"], report: ["reports"],
  sequence: ["sequences"], view: ["views"], viewDefinition: ["view-definitions"],
};

export const sha256 = (data: string | Uint8Array): string => crypto.createHash("sha256").update(data).digest("hex");

/** 設計のファイルの場所 (見つからなければ null) */
export async function entityFile(root: string, kind: OpsEntityKind, id: string): Promise<string | null> {
  if (!isOpsEntityKind(kind)) throw new Error(`設計の種類が正しくありません: ${String(kind)}`);
  assertSafeName(id, "id");
  const dataRoot = await resolveDataRoot(root);
  for (const d of DIRS[kind]) {
    const p = path.join(dataRoot, d, `${id}.json`);
    if (await fs.access(p).then(() => true, () => false)) return p;
  }
  return null;
}

export async function readEntityJson(root: string, kind: OpsEntityKind, id: string): Promise<unknown | null> {
  const p = await entityFile(root, kind, id);
  if (!p) return null;
  try { return JSON.parse(await fs.readFile(p, "utf-8")); } catch { return null; }
}

/** 内容の印。設計がない・読めないときは null */
export async function entityHash(root: string, kind: OpsEntityKind, id: string): Promise<string | null> {
  const j = await readEntityJson(root, kind, id);
  return j === null ? null : sha256(canonicalForHash(j));
}

/** 全設計の印 ("kind:id" → hash)。生成の記録の突き合わせ用。見る対象 (kinds/ids) を絞れる */
export async function entityHashes(root: string, wanted: Iterable<{ kind: OpsEntityKind; id: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const w of wanted) {
    const h = await entityHash(root, w.kind, w.id).catch(() => null);
    if (h) out.set(`${w.kind}:${w.id}`, h);
  }
  return out;
}
