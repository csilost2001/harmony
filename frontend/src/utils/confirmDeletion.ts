/**
 * 一覧で「削除」にしたものを保存する前の確認。削除する設計を、ほかの設計が参照していると、
 * 削除したあと参照先を失う (要確認になる) ため、保存の前に知らせる。
 */
import { mcpBridge } from "../mcp/mcpBridge";
import { REFERRER_LABELS, type ReferenceResult, type ReferenceTargetType } from "./references";

const MAX_LISTED = 8;
/** 参照元を調べる件数の上限。1 件ごとにワークスペース全体を走査するため、多いときは先頭だけを調べる */
export const MAX_CHECKED = 20;

/** 削除する設計の参照元を、確認ダイアログの文にする。参照されていなければ null */
export function describeDeletionImpact(
  deleted: ReadonlyArray<{ id: string; result: ReferenceResult }>,
  label: string,
  ignoreKinds: readonly string[] = [],
): string | null {
  const deletedSet = new Set(deleted.map((d) => d.id));
  const lines: string[] = [];
  for (const { id, result } of deleted) {
    // 同時に削除する設計どうしの参照は、気にしなくてよい
    const live = result.referrers.filter((r) => !(r.kind === (result.entityType as string) && deletedSet.has(r.id)) && !ignoreKinds.includes(r.kind));
    if (live.length === 0) continue;
    const shown = live.slice(0, MAX_LISTED).map((r) => `${REFERRER_LABELS[r.kind]}「${r.name ?? r.id}」`);
    const more = live.length > MAX_LISTED ? ` ほか ${live.length - MAX_LISTED} 件` : "";
    lines.push(`・${label}「${id}」← ${shown.join("、")}${more}`);
  }
  if (lines.length === 0) return null;
  return `削除する設計が、ほかの設計から参照されています。\n\n${lines.join("\n")}\n\n削除すると、これらは参照先を失い「要確認」になります。削除しますか?`;
}

/**
 * 削除を保存してよいか。参照されていなければ確認なしで true。調べられなかったときは確認せず true
 * (調べられないことで、保存を止めない)。
 */
export async function confirmDeletionImpact(entityType: ReferenceTargetType, label: string, deletedIds: Iterable<string>, ignoreKinds: readonly string[] = []): Promise<boolean> {
  const ids = [...deletedIds];
  if (ids.length === 0) return true;
  try {
    // 1 件ずつ (同時に何本も全体走査を走らせない)
    const results: Array<{ id: string; result: ReferenceResult }> = [];
    for (const id of ids.slice(0, MAX_CHECKED)) {
      results.push({ id, result: (await mcpBridge.request("findEntityReferences", { entityType, id })) as ReferenceResult });
    }
    const base = describeDeletionImpact(results, label, ignoreKinds);
    if (base === null) return true;
    const note = ids.length > MAX_CHECKED ? `\n\n(削除する ${ids.length} 件のうち、先頭の ${MAX_CHECKED} 件だけを調べました)` : "";
    return window.confirm(base + note);
  } catch {
    return true;
  }
}
