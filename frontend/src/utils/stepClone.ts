/**
 * 工程を複製して貼る (貼り付け・スニペットの挿入) ときの、ID の付け直し。
 * 付け直すのは、処理フローの「局所 ID」を持つものだけ (`collectAllProcessFlowLocalIds` が集めるものと同じ): 工程 (入れ子の中も、どの深さでも)・
 * 分岐 (`branches[]` / `elseBranch`)・付箋 (`notes[]`)。工程の中の、ほかの `id` (監査の `resource.id` など、対象を指す式) は、局所 ID ではないので、触れない。
 * 一部だけ付け直すと、別の処理フローへ貼る・同じスニペットを 2 回挿入するときに、同じ ID が重なる。
 * 複製した工程のあいだのジャンプ先 (`jumpTo` / `inlineBranch.ngJumpTo`) は、新しい ID に追従する。複製の外の工程への参照は、そのまま。
 */
import { nextLocalId } from "./localIdGenerator";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const PREFIXED = /^([A-Za-z][A-Za-z0-9]*)-\d+$/;

/** 工程の配列が入っている欄 (collectAllProcessFlowLocalIds の走査と同じ) */
const STEP_LIST_KEYS = ["steps", "subSteps", "onCommit", "onRollback", "onApproved", "onRejected", "onTimeout"] as const;

/** `existingIds` は、貼り先の処理フローの全 ID (付けた新しい ID を足して返す)。元の工程は書き換えない */
export function cloneStepsWithNewIds<T>(steps: readonly T[], existingIds: Set<string>): T[] {
  const clones = JSON.parse(JSON.stringify(steps)) as T[];
  const idMap = new Map<string, string>();
  const jumpOwners: Rec[] = [];

  const reid = (node: Rec, fallbackPrefix: string): void => {
    if (typeof node.id !== "string") return;
    const prefix = PREFIXED.exec(node.id)?.[1] ?? fallbackPrefix;
    const next = nextLocalId(existingIds, prefix, 2);
    existingIds.add(next);
    idMap.set(node.id, next);
    node.id = next;
  };
  const visitNotes = (notes: unknown): void => { if (Array.isArray(notes)) for (const n of notes) if (isRecord(n)) reid(n, "note"); };
  const visitSteps = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const s of list) {
      if (!isRecord(s)) continue;
      reid(s, "step");
      visitNotes(s.notes);
      if ("jumpTo" in s || (isRecord(s.inlineBranch) && "ngJumpTo" in s.inlineBranch)) jumpOwners.push(s);
      if (Array.isArray(s.branches)) for (const br of s.branches) if (isRecord(br)) { reid(br, "br"); visitSteps(br.steps); }
      if (isRecord(s.elseBranch)) { reid(s.elseBranch, "br"); visitSteps(s.elseBranch.steps); }
      for (const k of STEP_LIST_KEYS) visitSteps(s[k]);
      const sideEffectsOf = (outcomes: unknown) => { if (isRecord(outcomes)) for (const oc of Object.values(outcomes)) if (isRecord(oc)) visitSteps(oc.sideEffects); };
      sideEffectsOf(s.outcomes);
      if (isRecord(s.errorHandling)) sideEffectsOf(s.errorHandling.outcomes);
    }
  };
  visitSteps(clones);

  // 複製のあいだのジャンプ先を、新しい ID に直す (複製の外を指すものは、そのまま)
  for (const s of jumpOwners) {
    if (typeof s.jumpTo === "string" && idMap.has(s.jumpTo)) s.jumpTo = idMap.get(s.jumpTo);
    if (isRecord(s.inlineBranch) && typeof s.inlineBranch.ngJumpTo === "string" && idMap.has(s.inlineBranch.ngJumpTo)) s.inlineBranch.ngJumpTo = idMap.get(s.inlineBranch.ngJumpTo);
  }
  return clones;
}
