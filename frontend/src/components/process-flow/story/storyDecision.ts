/**
 * 判定表を「直す」操作 (表のマス・行・列の編集)。表の計算 (条件 → 列・行・指摘) は `@harmony/shared` の flowDecision.ts (設計書と共有)。
 * ここは、その計算を使って、道の条件の式を組み立て直す。仕様: docs/spec/process-flow-story-view.md
 */
import type { Step } from "../../../types/v3";
import { findStepDeep } from "../../../utils/stepTree";
import {
  atomFromRow, atomKey, composeDnf, parseDnf, type DtAlt, type DtCell, type DtRowSpec,
} from "@harmony/shared";
import { setArmCondition } from "./storyEdit";
import type { Loose } from "./storyModel";

// 表の計算は shared にある。既存の読み込み先を保つため、ここから再公開する
export {
  atomFromRow, atomKey, atomOf, armsEmptiedByRemoving, buildDecisionModel, columnName, composeDnf, COMPLEMENT, feasible, parseDnf, rowFromAtom,
  type DecisionModel, type DtAlt, type DtAtom, type DtCell, type DtColumn, type DtIssue, type DtRow, type DtRowSpec,
} from "@harmony/shared";

const exprOf = (cond: unknown): string | null => {
  const c = cond as { kind?: string; expression?: unknown } | undefined;
  if (c && c.kind !== undefined && c.kind !== "expression") return null;
  return typeof c?.expression === "string" ? c.expression : "";
};

// ─── 直す ──────────────────────────────────────────────

/** 道の条件の式を、列に分けて、直して、式に戻す。直せない (式でない・表にできない) 道は false */
function editArm(steps: Step[], ownerId: string, armId: string, fn: (alts: DtAlt[]) => DtAlt[] | null): boolean {
  const owner = findStepDeep(steps, ownerId) as unknown as Loose | null;
  if (!owner) return false;
  const arm = (owner.branches as Array<Record<string, unknown>> | undefined)?.find((b, i) => String(b.id || i) === armId);
  if (!arm) return false;
  const expr = exprOf(arm.condition);
  if (expr === null) return false;
  const alts = parseDnf(expr);
  if (alts === null) return false;
  const next = fn(alts.map((a) => [...a]));
  if (!next) return false;
  // 条件がすべて「－」の列を、ほかの列と並べて残すと、「いつでも成り立つ」に見えるが、式には書けない (捨てると、道が狭くなる)。黙って変えず、断る
  if (next.length > 1 && next.some((alt) => alt.length === 0)) return false;
  return setArmCondition(steps, ownerId, armId, composeDnf(next));
}

/**
 * 「～ が ある (!= null)」の条件は、その項目の中身を使う条件より前に置く。条件は左から順に調べるので (`@a != null && @a.b > 0`)、
 * 並びを変えると、空のときに、中身を見に行って失敗する
 */
function guardFirst(alt: DtAlt): void {
  for (let i = 0; i < alt.length; i++) {
    const g = alt[i].clause;
    if (!g || g.op !== "notNull") continue;
    const use = alt.findIndex((a) => a.clause && a !== alt[i] && (a.clause.subject.startsWith(`${g.subject}.`) || a.clause.subject.startsWith(`${g.subject}[`)));
    if (use >= 0 && use < i) { const [m] = alt.splice(i, 1); alt.splice(use, 0, m); }
  }
}

/** 表のマス (行 × 道の何列目) を、○ / × / － にする。道が無い列 (altIndex が列の数と同じ) は、「または」の列を足す */
export function setDtCell(steps: Step[], ownerId: string, armId: string, altIndex: number, row: DtRowSpec, cell: DtCell): boolean {
  return editArm(steps, ownerId, armId, (alts) => {
    if (alts.length === 0) alts.push([]);
    if (altIndex > alts.length) return null;
    if (altIndex === alts.length) alts.push([]);
    const alt = alts[altIndex];
    const at = alt.findIndex((a) => atomKey(a) === row.key);
    if (cell === "any") {
      if (at >= 0) alt.splice(at, 1);
      return alts;
    }
    const atom = atomFromRow(row, cell === "no");
    if (!atom) return null;
    if (at >= 0) alt[at] = atom;
    else alt.push(atom);
    guardFirst(alt);
    return alts;
  });
}

/** 道の「または」の列を 1 つ外す (道に列が 1 つしかないときは、外せない) */
export function removeDtAlt(steps: Step[], ownerId: string, armId: string, altIndex: number): boolean {
  return editArm(steps, ownerId, armId, (alts) => {
    if (alts.length < 2 || altIndex < 0 || altIndex >= alts.length) return null;
    alts.splice(altIndex, 1);
    return alts;
  });
}

/** 行の条件を、別の条件に置き換える (すべての道の、その行の ○ × を引き継ぐ)。直した道の数を返す (-1: 失敗) */
export function replaceDtRow(steps: Step[], ownerId: string, oldRow: DtRowSpec, newRow: DtRowSpec): number {
  const owner = findStepDeep(steps, ownerId) as unknown as Loose | null;
  const arms = (owner?.branches as Array<Record<string, unknown>> | undefined) ?? [];
  let n = 0;
  arms.forEach((b, i) => {
    const armId = String(b.id || i);
    const ok = editArm(steps, ownerId, armId, (alts) => {
      let touched = false;
      for (const alt of alts) {
        alt.forEach((a, k) => {
          if (atomKey(a) !== oldRow.key) return;
          const neg = oldRow.clause && a.clause ? a.clause.op !== oldRow.clause.op : a.neg;
          const na = atomFromRow(newRow, neg);
          if (na) { alt[k] = na; touched = true; }
        });
        // 置き換えで、同じ行が 2 つになったら、1 つにする
        const seen = new Set<string>();
        for (let k = alt.length - 1; k >= 0; k--) { const key = atomKey(alt[k]); if (seen.has(key)) alt.splice(k, 1); else seen.add(key); }
      }
      return touched ? alts : null;
    });
    if (ok) n++;
  });
  return n;
}

/** 行を消す (すべての道から、その条件を外す)。直した道の数 */
export function removeDtRow(steps: Step[], ownerId: string, row: DtRowSpec): number {
  const owner = findStepDeep(steps, ownerId) as unknown as Loose | null;
  const arms = (owner?.branches as Array<Record<string, unknown>> | undefined) ?? [];
  let n = 0;
  arms.forEach((b, i) => {
    const ok = editArm(steps, ownerId, String(b.id || i), (alts) => {
      let touched = false;
      for (const alt of alts) for (let k = alt.length - 1; k >= 0; k--) if (atomKey(alt[k]) === row.key) { alt.splice(k, 1); touched = true; }
      return touched ? alts : null;
    });
    if (ok) n++;
  });
  return n;
}

