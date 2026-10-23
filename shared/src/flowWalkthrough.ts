/**
 * 処理フローの机上演習 (UI 改善提案 続編 第 8 弾 #151)。いまの処理を、開始から順に辿り、分岐・繰り返しでは、利用者が進む先を選ぶ。
 * 実行はしない (条件は評価せず、人が選ぶ)。通った工程・選んだ枝と、そこまでに定義された変数を残し、レビューの会議でそのまま使える。
 * 状態は不変 (操作のたびに新しい状態を返す)。画面に依存しない純関数。画面 (frontend) と MCP (designer__walk_flow) が共有する。
 */
import { kindLabel, stepText, branchConditionText, type FlowStep } from "./flowStructure.js";

type AnyStep = FlowStep & Record<string, unknown>;

interface Frame {
  steps: readonly FlowStep[];
  index: number;
  /** 繰り返しの本体なら、何回目か */
  loop?: { stepId: string; iteration: number };
  /** この枠を終えたときの意味 (表示用) */
  note: string;
}

export interface WalkLogEntry { kind: "step" | "choice" | "end"; text: string; stepId?: string }

export interface WalkState {
  stack: readonly Frame[];
  log: readonly WalkLogEntry[];
  /** ここまでに定義された変数 (outputBinding・繰り返しの 1 件の名前) */
  defined: readonly string[];
  ended: boolean;
  endReason: string;
}

export type WalkPrompt =
  | { kind: "step"; step: FlowStep; text: string }
  | { kind: "branch"; step: FlowStep; text: string; choices: Array<{ id: string; label: string }> }
  | { kind: "loop"; step: FlowStep; text: string; iteration: number; choices: Array<{ id: string; label: string }> }
  | { kind: "loopEnd"; step: FlowStep; text: string; iteration: number; choices: Array<{ id: string; label: string }> }
  | { kind: "end"; reason: string };

export function startWalk(steps: readonly FlowStep[]): WalkState {
  return normalize({ stack: [{ steps, index: 0, note: "処理の開始" }], log: [], defined: [], ended: false, endReason: "" });
}

/** 枠の終わりに来ていたら、枠を閉じて外へ戻る (繰り返しの本体の終わりは、「もう 1 回?」の確認で止まる)。全部終わったら ended */
function normalize(s: WalkState): WalkState {
  let st = s;
  for (;;) {
    const top = st.stack[st.stack.length - 1];
    if (!top) return { ...st, ended: true, endReason: st.endReason || "処理の最後まで進みました" };
    if (top.index < top.steps.length) return st;
    if (top.loop) return st; // 繰り返しの本体の終わり: promptOf が「もう 1 回?」を出す
    st = { ...st, stack: st.stack.slice(0, -1) };
  }
}

export function promptOf(s: WalkState): WalkPrompt {
  if (s.ended) return { kind: "end", reason: s.endReason };
  const top = s.stack[s.stack.length - 1];
  if (top.index >= top.steps.length && top.loop) {
    const owner = findStep(s, top.loop.stepId);
    return { kind: "loopEnd", step: owner ?? top.steps[0], text: `繰り返し (${top.loop.iteration} 回目が終わりました)`, iteration: top.loop.iteration, choices: [{ id: "again", label: "もう 1 回繰り返す" }, { id: "exit", label: "繰り返しを終える" }] };
  }
  const step = top.steps[top.index];
  const text = `${kindLabel(step)}: ${stepText(step)}`;
  const x = step as AnyStep;
  if (step.kind === "branch") {
    const choices: Array<{ id: string; label: string }> = ((x.branches as Array<{ code: string; label?: string; condition: unknown }> | undefined) ?? []).map((b, i) => ({ id: `b${i}`, label: `${b.code}: ${b.label ?? ""}${branchConditionText(b.condition) ? ` [${branchConditionText(b.condition)}]` : ""}` }));
    const eb = x.elseBranch as { code?: string; label?: string } | undefined;
    choices.push({ id: "else", label: eb ? `${eb.code ?? "else"}: ${eb.label ?? "上記以外"}` : "どの条件にも合わない (何もせず次へ)" });
    return { kind: "branch", step, text, choices };
  }
  if (step.kind === "loop") {
    return { kind: "loop", step, text, iteration: 0, choices: [{ id: "enter", label: "繰り返しに入る (1 回目)" }, { id: "skip", label: "繰り返さない (0 回)" }] };
  }
  return { kind: "step", step, text };
}

function findStep(s: WalkState, id: string): FlowStep | undefined {
  for (const f of s.stack) for (const st of f.steps) if (st.id === id) return st;
  return undefined;
}

const defineOf = (step: FlowStep): string[] => {
  const x = step as AnyStep;
  const out: string[] = [];
  const ob = (x.outputBinding as { name?: string } | undefined)?.name?.trim();
  if (ob) out.push(ob);
  return out;
};

const addDefined = (d: readonly string[], names: string[]) => [...d, ...names.filter((n) => !d.includes(n))];
const advance = (stack: readonly Frame[]): Frame[] => stack.map((f, i) => (i === stack.length - 1 ? { ...f, index: f.index + 1 } : f));

/** 次へ進む (通常の工程)。分岐・繰り返しでは、choose を使う。return の工程で、処理は終わる */
export function next(s: WalkState): WalkState {
  const p = promptOf(s);
  if (p.kind !== "step") return s;
  const step = p.step;
  const x = step as AnyStep;
  const log: WalkLogEntry = { kind: "step", text: p.text, stepId: step.id };
  const defined = addDefined(s.defined, defineOf(step));
  if (step.kind === "return") return { ...s, log: [...s.log, log, { kind: "end", text: "レスポンスを返して終了" }], defined, ended: true, endReason: "return の工程で、処理が終わりました" };
  // 配下の工程 (subSteps)・トランザクションの中は、その工程のあとに、中を順に辿る
  const childList = step.kind === "transactionScope" ? (x.steps as FlowStep[] | undefined) : (x.subSteps as FlowStep[] | undefined);
  const stack = advance(s.stack);
  if (childList && childList.length > 0) {
    return normalize({ ...s, stack: [...stack, { steps: childList, index: 0, note: step.kind === "transactionScope" ? "トランザクションの中" : "配下の工程" }], log: [...s.log, log], defined });
  }
  return normalize({ ...s, stack, log: [...s.log, log], defined });
}

/** 分岐・繰り返しの選択 */
export function choose(s: WalkState, choiceId: string): WalkState {
  const p = promptOf(s);
  if (p.kind === "branch") {
    const x = p.step as AnyStep;
    const picked = p.choices.find((c) => c.id === choiceId);
    if (!picked) return s;
    const log: WalkLogEntry[] = [...s.log, { kind: "step", text: p.text, stepId: p.step.id }, { kind: "choice", text: `選んだ枝 → ${picked.label}` }];
    const stack = advance(s.stack);
    let armSteps: FlowStep[] | undefined;
    if (choiceId === "else") armSteps = (x.elseBranch as { steps?: FlowStep[] } | undefined)?.steps;
    else armSteps = (x.branches as Array<{ steps?: FlowStep[] }>)[Number(choiceId.slice(1))]?.steps;
    if (armSteps && armSteps.length > 0) return normalize({ ...s, stack: [...stack, { steps: armSteps, index: 0, note: `枝 ${picked.label}` }], log });
    return normalize({ ...s, stack, log });
  }
  if (p.kind === "loop") {
    const body = (p.step as AnyStep).steps as FlowStep[] | undefined;
    const defined = addDefined(s.defined, [((p.step as AnyStep).collectionItemName as string | undefined) ?? ""].filter(Boolean));
    const log: WalkLogEntry[] = [...s.log, { kind: "step", text: p.text, stepId: p.step.id }, { kind: "choice", text: choiceId === "enter" ? "繰り返しに入る (1 回目)" : "繰り返さない (0 回)" }];
    const stack = advance(s.stack);
    if (choiceId === "enter" && body && body.length > 0) return normalize({ ...s, stack: [...stack, { steps: body, index: 0, loop: { stepId: p.step.id, iteration: 1 }, note: "繰り返しの中 (1 回目)" }], log, defined });
    return normalize({ ...s, stack, log, defined });
  }
  if (p.kind === "loopEnd") {
    const top = s.stack[s.stack.length - 1];
    if (choiceId === "again" && top.loop) {
      const it = top.loop.iteration + 1;
      const stack = s.stack.map((f, i) => (i === s.stack.length - 1 ? { ...f, index: 0, loop: { ...top.loop!, iteration: it }, note: `繰り返しの中 (${it} 回目)` } : f));
      return { ...s, stack, log: [...s.log, { kind: "choice", text: `もう 1 回 (${it} 回目)` }] };
    }
    return normalize({ ...s, stack: s.stack.slice(0, -1), log: [...s.log, { kind: "choice", text: `繰り返しを終える (${top.loop?.iteration ?? 0} 回)` }] });
  }
  return s;
}

/** いまの深さ (入れ子の中にいるか) の表示用 */
export function whereAmI(s: WalkState): string[] { return s.stack.map((f) => f.note); }
