/**
 * 処理フローの「流れ」表示で直すための、純粋な編集操作 (表示に依存しない)。
 *
 * どれも、渡された工程の木 (編集中の下書き) を直接書き換える。呼び出し側 (`updateGroupWithDraft`) が、複製した下書きに対して使う。
 * 場所は「枠の住所」で指す: 持ち主の工程 ID と、枠の名前 (storyModel の ChildGroup.key と同じ)。持ち主が null なら最上位。
 *
 * 仕様: docs/spec/process-flow-story-view.md
 */
import type { Step } from "../../../types/v3";
import { findStepDeep, locateStep } from "../../../utils/stepTree";
import { nextLocalId } from "../../../utils/localIdGenerator";

type Rec = Record<string, unknown>;
const rec = (s: unknown): Rec => s as Rec;

/** 工程の並びの住所。ownerId が null なら最上位。key は ChildGroup.key (`arm:<id>` `else` `body` `ok` `ng` `commit` `rollback` `approved` `rejected` `timeout` `sub`) */
export interface ListAddr {
  ownerId: string | null;
  key: string;
}

export const TOP: ListAddr = { ownerId: null, key: "top" };

/** 住所の並びを返す。create なら、まだ無い枠を作る (else は作らない: ensureElse を使う)。無ければ null */
export function resolveList(steps: Step[], addr: ListAddr, create = false): Step[] | null {
  if (addr.ownerId === null) return steps;
  const owner = findStepDeep(steps, addr.ownerId);
  if (!owner) return null;
  const o = rec(owner);
  const arr = (holder: Rec, k: string): Step[] | null => {
    if (Array.isArray(holder[k])) return holder[k] as Step[];
    if (!create) return null;
    holder[k] = [];
    return holder[k] as Step[];
  };
  switch (addr.key) {
    case "body": return arr(o, "steps");
    case "commit": return arr(o, "onCommit");
    case "rollback": return arr(o, "onRollback");
    case "approved": return arr(o, "onApproved");
    case "rejected": return arr(o, "onRejected");
    case "timeout": return arr(o, "onTimeout");
    case "sub": return arr(o, "subSteps");
    case "else": return rec(o.elseBranch) && o.elseBranch ? arr(rec(o.elseBranch), "steps") : null;
    case "ok":
    case "ng": {
      if (!o.inlineBranch) {
        if (!create) return null;
        o.inlineBranch = { ok: [], ng: [] };
      }
      return arr(rec(o.inlineBranch), addr.key);
    }
    default: {
      if (addr.key.startsWith("arm:")) {
        const id = addr.key.slice(4);
        const branches = Array.isArray(o.branches) ? (o.branches as Rec[]) : [];
        const arm = branches.find((b, i) => String(b.id || i) === id);
        return arm ? arr(arm, "steps") : null;
      }
      return null;
    }
  }
}

/** 工程を、住所の index 番目に入れる。入れられたら true */
export function insertSteps(steps: Step[], addr: ListAddr, index: number, items: readonly Step[]): boolean {
  const list = resolveList(steps, addr, true);
  if (!list) return false;
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, ...items);
  return true;
}

/** 最上位の見出しが、工程と一緒に消えたり動いたりしないよう、次の工程へ引き継ぐ */
function handOverHeading(list: Step[], index: number, isTop: boolean): void {
  if (!isTop) return;
  const moved = rec(list[index]);
  const heading = typeof moved.heading === "string" ? moved.heading : "";
  if (!heading) return;
  const next = list[index + 1];
  if (next && !rec(next).heading) rec(next).heading = heading;
  delete moved.heading;
}

/** 工程を、入れ子ごと消す。消した工程を返す */
export function removeStepById(steps: Step[], id: string): Step | null {
  const loc = locateStep(steps, id);
  if (!loc) return null;
  handOverHeading(loc.list, loc.index, loc.list === steps);
  const [removed] = loc.list.splice(loc.index, 1);
  return removed ?? null;
}

/** id の工程の中 (入れ子の全部) に、別の工程 id が入っているか (自分の中へ動かせないため) */
function contains(step: Step, id: string): boolean {
  return step.id === id || findStepDeep([step], id) !== null;
}

/** その工程を、その枠へ動かせるか (自分の中・自分の子孫の中へは動かせない) */
export function canMoveInto(steps: Step[], id: string, ownerId: string | null): boolean {
  const loc = locateStep(steps, id);
  if (!loc) return false;
  return ownerId === null || !contains(loc.list[loc.index], ownerId);
}

/** 工程を、住所の index 番目へ動かす (同じ並びの中なら、動かす前の位置を引いて数える)。自分の中へは動かせない */
export function moveStepTo(steps: Step[], id: string, addr: ListAddr, index: number): boolean {
  const loc = locateStep(steps, id);
  if (!loc) return false;
  const self = loc.list[loc.index];
  if (addr.ownerId !== null && contains(self, addr.ownerId)) return false;
  const dst = resolveList(steps, addr, true);
  if (!dst) return false;
  // 先に、見出しを引き継ぐ (最上位から出るとき・最上位の中で動くとき)
  if (loc.list === steps) handOverHeading(loc.list, loc.index, true);
  const [moved] = loc.list.splice(loc.index, 1);
  let at = Math.max(0, Math.min(index, dst.length + (dst === loc.list ? 1 : 0)));
  if (dst === loc.list && loc.index < at) at -= 1;
  at = Math.max(0, Math.min(at, dst.length));
  // 最上位でなくなる工程は、見出しの意味が無い
  if (dst !== steps) delete rec(moved).heading;
  dst.splice(at, 0, moved);
  return true;
}

/** 同じ並びの中で、delta (+1 / -1) 動かす。端なら false */
export function moveStepBy(steps: Step[], id: string, delta: 1 | -1): boolean {
  const loc = locateStep(steps, id);
  if (!loc) return false;
  const to = loc.index + delta;
  if (to < 0 || to >= loc.list.length) return false;
  const isTop = loc.list === steps;
  if (isTop) {
    // 見出しは、位置ではなく「区切りの先頭」に付く: 動かす工程のものを、先頭に残す
    const a = rec(loc.list[loc.index]);
    const b = rec(loc.list[to]);
    const ha = a.heading;
    const hb = b.heading;
    delete a.heading;
    delete b.heading;
    [loc.list[loc.index], loc.list[to]] = [loc.list[to], loc.list[loc.index]];
    const first = Math.min(loc.index, to);
    const heading = (loc.index < to ? ha : hb) ?? undefined;
    const other = (loc.index < to ? hb : ha) ?? undefined;
    // 先頭の位置にいた工程の見出しを、新しく先頭になった工程へ。後ろの位置にいた工程の見出しは、後ろの工程へ
    if (heading !== undefined) rec(loc.list[first]).heading = heading;
    if (other !== undefined) rec(loc.list[first + 1]).heading = other;
    return true;
  }
  [loc.list[loc.index], loc.list[to]] = [loc.list[to], loc.list[loc.index]];
  return true;
}

/** 工程の項目を直す。値が undefined の項目は消す。直せたら true */
export function patchStep(steps: Step[], id: string, patch: Record<string, unknown>): boolean {
  const step = findStepDeep(steps, id);
  if (!step) return false;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete rec(step)[k];
    else rec(step)[k] = v;
  }
  return true;
}

/** 結果変数の呼び名・名前を直す (outputBinding が無ければ作る。名前が空なら作らない) */
export function patchOutputBinding(steps: Step[], id: string, patch: { name?: string; label?: string | undefined }): boolean {
  const step = findStepDeep(steps, id);
  if (!step) return false;
  const s = rec(step);
  const cur = (s.outputBinding as Rec | undefined) ?? {};
  const next: Rec = { ...cur };
  if (patch.name !== undefined) next.name = patch.name;
  if ("label" in patch) {
    if (patch.label) next.label = patch.label;
    else delete next.label;
  }
  if (!next.name) return false;
  s.outputBinding = next;
  return true;
}

/** 見出しを付ける・直す・外す (最上位の工程だけ)。空の文字列は、外す */
export function setHeading(steps: Step[], id: string, text: string): boolean {
  const idx = steps.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  const t = text.trim().slice(0, 80);
  if (t) rec(steps[idx]).heading = t;
  else delete rec(steps[idx]).heading;
  return true;
}

/** 分岐の腕の条件を直す */
export function setArmCondition(steps: Step[], ownerId: string, armId: string, expression: string): boolean {
  const owner = findStepDeep(steps, ownerId);
  const branches = owner && Array.isArray(rec(owner).branches) ? (rec(owner).branches as Rec[]) : [];
  const arm = branches.find((b, i) => String(b.id || i) === armId);
  if (!arm) return false;
  // 式の条件だけを書き換える (tryCatch・更新 0 件・外部呼び出しの結果の条件は、中身 (エラーコードなど) が消えるので、ここでは直さない)
  const cur = rec(arm.condition);
  if (cur.kind !== undefined && cur.kind !== "expression") return false;
  arm.condition = { kind: "expression", expression };
  return true;
}

/** 分岐の腕を足す (記号は、次の文字)。足した腕の id を返す */
export function addArm(steps: Step[], ownerId: string, ids: Set<string>): string | null {
  const owner = findStepDeep(steps, ownerId);
  if (!owner || owner.kind !== "branch") return null;
  const o = rec(owner);
  const branches = (Array.isArray(o.branches) ? o.branches : (o.branches = [])) as Rec[];
  const used = new Set(branches.map((b) => String(b.code)));
  const elseCode = o.elseBranch ? rec(o.elseBranch).code : undefined;
  if (elseCode) used.add(String(elseCode));
  let code = "A";
  for (let c = 65; c <= 90; c++) { if (!used.has(String.fromCharCode(c))) { code = String.fromCharCode(c); break; } }
  const id = nextLocalId(ids, "br", 2);
  ids.add(id);
  branches.push({ id, code, condition: { kind: "expression", expression: "" }, steps: [] });
  return id;
}

/** 分岐の腕を消す (中の工程も) */
export function removeArm(steps: Step[], ownerId: string, armId: string): boolean {
  const owner = findStepDeep(steps, ownerId);
  const branches = owner && Array.isArray(rec(owner).branches) ? (rec(owner).branches as Rec[]) : [];
  const i = branches.findIndex((b, k) => String(b.id || k) === armId);
  if (i < 0) return false;
  branches.splice(i, 1);
  return true;
}

/** 「それ以外」の枠を作る (すでにあれば何もしない) */
export function ensureElse(steps: Step[], ownerId: string, ids: Set<string>): boolean {
  const owner = findStepDeep(steps, ownerId);
  if (!owner || owner.kind !== "branch") return false;
  const o = rec(owner);
  if (o.elseBranch) return true;
  const id = nextLocalId(ids, "br", 2);
  ids.add(id);
  // 「それ以外」の記号は、慣習で X (道の記号 A, B… と重ならない。X が使われていれば、W, V… の順)
  const used = new Set((Array.isArray(o.branches) ? (o.branches as Rec[]) : []).map((b) => String(b.code)));
  let code = "X";
  for (let c = 88; c >= 65; c--) { if (!used.has(String.fromCharCode(c))) { code = String.fromCharCode(c); break; } }
  o.elseBranch = { id, code, steps: [] };
  return true;
}

/** 枠 (承認の結果・確定 / 取り消しのあと・入力エラーの道) を、空で作る */
export function ensureGroup(steps: Step[], ownerId: string, key: string): boolean {
  return resolveList(steps, { ownerId, key }, true) !== null;
}

/** 変数の名前に使えない語 (処理の外の名前空間・予約) */
export const RESERVED_VAR_NAMES: readonly string[] = ["inputs", "var", "conv", "env", "secret", "const", "msg", "global", "session", "ctx", "this"];

/**
 * 変数の名前を変えたとき、その変数を作る工程 (同じ名前を作る工程すべて。結果変数・繰り返しの 1 行・番号) と、
 * 使っている式の `@旧名` (`@var.旧名` / `@var.action|loop|flowParameter|global.旧名` / `@var.step|tx.<工程>.旧名` を含む) を、新しい名前に直す。
 * `@` の直前が識別子の文字 (メールアドレスなど) のものと、`@conv.旧名` のように別の名前空間の下のものは、変えない。
 */
export function renameVariable(steps: readonly unknown[], from: string, to: string): void {
  if (!from || !to || from === to) return;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w.])@(var\\.(?:action|loop|flowParameter|global)\\.|var\\.(?:step|tx)\\.[\\w-]+\\.|var\\.)?${esc}(?![A-Za-z0-9_])`, "g");
  const fixStr = (v: string) => v.replace(re, (_m, scope: string | undefined) => `@${scope ?? ""}${to}`);
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") {
      // 作る側の名前 (@ の付かない文字列)
      if ((key === "name" || key === "collectionItemName" || key === "collectionIndexName" || key === "fieldErrorsVar" || key === "errorVar") && v === from) return to;
      return fixStr(v);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        // name は、結果変数 (outputBinding.name) のときだけ。ほかの name (入力の名前など) は変えない
        if (k === "name" && key !== "outputBinding") continue;
        o[k] = walk(o[k], k);
      }
      return o;
    }
    return v;
  };
  walk(steps);
}
