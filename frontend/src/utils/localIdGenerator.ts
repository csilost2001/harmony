// #1332 Codex 10 巡目 M1: frontend UI 経路の Action/Step/Branch/Note id を
// LocalId (kebab-case + 連番、例: `act-001` / `step-01` / `br-01`) で採番する。
//
// backend `nextLocalId` (backend/src/handlers/processFlow.ts) と命名規約を共有:
// - act-: 3 桁 padding (`act-001`, `act-002`, ...)
// - step-: 2 桁 padding (`step-01`, `step-02`, ...)
// - br-: 2 桁 padding (`br-01`, `br-02`, ...)
// - note-: 2 桁 padding (`note-01`, ...)
//
// 既存 ID 集合の中で同 prefix + 数字 suffix の最大値 +1 を採番、
// 衝突回避のため更に increment する。階層命名 (`step-01-a-01` 等) は本 helper では扱わない。

import type { LocalId } from "../types/v3";

/**
 * 既存 ID 集合から prefix 付き LocalId を採番する。
 *
 * @param existingIds 既存 ID の Set (collectAllProcessFlowLocalIds 等で収集)
 * @param prefix 例: "act" / "step" / "br" / "note"
 * @param padWidth 0-padding 桁数 (act: 3, step/br/note: 2)
 * @returns 採番された LocalId (例: "act-001", "step-02", "br-03")
 */
export function nextLocalId(
  existingIds: Set<string>,
  prefix: string,
  padWidth = 2,
): LocalId {
  // 既存 ID から `<prefix>-<digits>` 形式を抽出して最大値を求める
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escapedPrefix}-(\\d+)$`);
  let maxN = 0;
  for (const id of existingIds) {
    const m = id.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  // maxN + 1 から開始、衝突したら +1 ずつ (intra-entity 階層命名と被るケースを想定)
  let candidateN = maxN + 1;
  for (let attempt = 0; attempt <= existingIds.size; attempt++) {
    const candidate = `${prefix}-${String(candidateN).padStart(padWidth, "0")}`;
    if (!existingIds.has(candidate)) return candidate as LocalId;
    candidateN++;
  }
  // 万一全て衝突する場合は padding を伸ばす (実運用では到達しない安全側)
  return `${prefix}-${String(candidateN).padStart(padWidth + 1, "0")}` as LocalId;
}

/**
 * ProcessFlow doc (untyped) から全 LocalId を再帰収集する。
 * - actions[].id (Action.id)
 * - actions[].responses[].id (Response.id)
 * - actions[].steps[].id / steps[].branches[].id / steps[].branches[].steps[].id ...
 * - steps[].subSteps[].id (UI 内 sub-step 拡張)
 * - steps[].errorHandling.outcomes.<key>.sideEffects[].id
 * - actions[].steps[]....notes[].id
 *
 * `unknown` を取って structural walk するので, 部分 doc / clone 中の object でも安全に呼べる。
 * `existingIds.size` ベースの衝突回避なので、collected set は重複を許容しない。
 *
 * backend `collectAllLocalIds` (backend/src/handlers/processFlow.ts:102) と semantics 整合。
 */
export function collectAllProcessFlowLocalIds(doc: unknown): Set<string> {
  const ids = new Set<string>();

  const visitNotes = (notes: unknown): void => {
    if (!Array.isArray(notes)) return;
    for (const n of notes) {
      if (n && typeof n === "object") {
        const nid = (n as { id?: unknown }).id;
        if (typeof nid === "string") ids.add(nid);
      }
    }
  };

  const visitSteps = (steps: unknown): void => {
    if (!Array.isArray(steps)) return;
    for (const s of steps) {
      if (!s || typeof s !== "object") continue;
      const sr = s as Record<string, unknown>;
      if (typeof sr.id === "string") ids.add(sr.id);
      visitNotes(sr.notes);
      // branch / loop / transactionScope の子 step
      if (Array.isArray(sr.branches)) {
        for (const br of sr.branches) {
          if (br && typeof br === "object") {
            const brId = (br as { id?: unknown }).id;
            if (typeof brId === "string") ids.add(brId);
            visitSteps((br as { steps?: unknown }).steps);
          }
        }
      }
      const elseBranch = sr.elseBranch as Record<string, unknown> | undefined;
      if (elseBranch && typeof elseBranch === "object") {
        if (typeof elseBranch.id === "string") ids.add(elseBranch.id);
        visitSteps(elseBranch.steps);
      }
      visitSteps(sr.steps);
      visitSteps(sr.subSteps);
      visitSteps(sr.onCommit);
      visitSteps(sr.onRollback);
      visitSteps(sr.onApproved);
      visitSteps(sr.onRejected);
      visitSteps(sr.onTimeout);
      // outcomes.<key>.sideEffects (NonReturnStep[])
      const outcomes = sr.outcomes as Record<string, Record<string, unknown>> | undefined;
      if (outcomes && typeof outcomes === "object") {
        for (const oc of Object.values(outcomes)) {
          if (oc && typeof oc === "object") visitSteps((oc as { sideEffects?: unknown }).sideEffects);
        }
      }
      const errorHandling = sr.errorHandling as Record<string, unknown> | undefined;
      const ehOutcomes = errorHandling?.outcomes as Record<string, Record<string, unknown>> | undefined;
      if (ehOutcomes && typeof ehOutcomes === "object") {
        for (const oc of Object.values(ehOutcomes)) {
          if (oc && typeof oc === "object") visitSteps((oc as { sideEffects?: unknown }).sideEffects);
        }
      }
    }
  };

  if (!doc || typeof doc !== "object") return ids;
  const docR = doc as Record<string, unknown>;
  const actions = Array.isArray(docR.actions) ? (docR.actions as unknown[]) : [];
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const ar = a as Record<string, unknown>;
    if (typeof ar.id === "string") ids.add(ar.id);
    visitNotes(ar.notes);
    if (Array.isArray(ar.responses)) {
      for (const r of ar.responses) {
        if (r && typeof r === "object") {
          const rid = (r as { id?: unknown }).id;
          if (typeof rid === "string") ids.add(rid);
        }
      }
    }
    visitSteps(ar.steps);
  }

  // authoring.notes (group-level)
  const authoring = docR.authoring as Record<string, unknown> | undefined;
  if (authoring && typeof authoring === "object") {
    visitNotes(authoring.notes);
  }
  return ids;
}

/**
 * Step subtree (cloned step) から step / branch / subStep id を再帰収集する helper。
 * duplicate / paste 時に「ペースト元の clone subtree 内」と「ペースト先 ProcessFlow 全体」
 * の両方から collect して衝突回避する用途。
 */
export function collectStepSubtreeLocalIds(step: unknown): Set<string> {
  // 1 step を仮想 action.steps として feed することで visitSteps を再利用
  return collectAllProcessFlowLocalIds({ actions: [{ steps: [step] }] });
}
