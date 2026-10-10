/**
 * 一覧で「削除」にしたものを保存する前の確認。削除する設計を、ほかの設計が参照していると、
 * 削除したあと参照先を失う (要確認になる) ため、保存の前に知らせる。
 */
import { mcpBridge } from "../mcp/mcpBridge";
import { REFERRER_LABELS, type ReferenceResult, type ReferenceTargetType } from "./references";

const MAX_LISTED = 8;

/** 削除する設計の参照元を、確認ダイアログの文にする。参照されていなければ null */
export function describeDeletionImpact(
  deleted: ReadonlyArray<{ id: string; result: ReferenceResult }>,
  label: string,
): string | null {
  const deletedSet = new Set(deleted.map((d) => d.id));
  const lines: string[] = [];
  for (const { id, result } of deleted) {
    // 同時に削除する設計どうしの参照は、気にしなくてよい
    const live = result.referrers.filter((r) => !(r.kind === (result.entityType as string) && deletedSet.has(r.id)));
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
export async function confirmDeletionImpact(entityType: ReferenceTargetType, label: string, deletedIds: Iterable<string>): Promise<boolean> {
  const ids = [...deletedIds];
  if (ids.length === 0) return true;
  try {
    const results = await Promise.all(ids.map(async (id) => ({
      id,
      result: (await mcpBridge.request("findEntityReferences", { entityType, id })) as ReferenceResult,
    })));
    const message = describeDeletionImpact(results, label);
    return message === null ? true : window.confirm(message);
  } catch {
    return true;
  }
}
