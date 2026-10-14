/**
 * 工程を複製して貼る (貼り付け・スニペットの挿入) ときの、ID の付け直し。
 * 工程の入れ子 (subSteps・分岐の中・ループの中・トランザクションの中など、どの深さでも) の `id` を、すべて新しいものにする。
 * 一部だけ付け直すと、別の処理フローへ貼る・同じスニペットを 2 回挿入するときに、同じ ID が重なる。
 * 複製した工程のあいだの参照 (ジャンプ先など、複製した ID と同じ文字列の値) は、新しい ID に追従する。複製の外の工程への参照は、そのまま。
 */
import { nextLocalId } from "./localIdGenerator";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const PREFIXED = /^([A-Za-z][A-Za-z0-9]*)-\d+$/;

/** `existingIds` は、貼り先の処理フローの全 ID (付けた新しい ID を足して返す)。元の工程は書き換えない */
export function cloneStepsWithNewIds<T>(steps: readonly T[], existingIds: Set<string>): T[] {
  const clones = JSON.parse(JSON.stringify(steps)) as T[];
  const idMap = new Map<string, string>();
  const reid = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(reid); return; }
    if (!isRecord(node)) return;
    if (typeof node.id === "string") {
      const prefix = PREFIXED.exec(node.id)?.[1] ?? "step";
      const next = nextLocalId(existingIds, prefix, 2);
      existingIds.add(next);
      idMap.set(node.id, next);
      node.id = next;
    }
    for (const [k, v] of Object.entries(node)) if (k !== "id") reid(v);
  };
  reid(clones);
  // 複製のあいだの参照を、新しい ID に直す (id そのものは、上で直した)
  const remap = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach((v, i) => { if (typeof v === "string" && idMap.has(v)) node[i] = idMap.get(v); else remap(v); }); return; }
    if (!isRecord(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "id") continue;
      if (typeof v === "string" && idMap.has(v)) node[k] = idMap.get(v);
      else remap(v);
    }
  };
  remap(clones);
  return clones;
}
