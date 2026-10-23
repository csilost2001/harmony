/**
 * 処理フローの机上演習。計算は `@harmony/shared` の flowWalkthrough.ts (MCP の designer__walk_flow と共有)。ここは、画面側の既存の読み込み先を保つための再公開。
 */
import { flowWalkthrough as w } from "@harmony/shared";

export type { WalkState, WalkPrompt, WalkLogEntry } from "@harmony/shared";
export const startWalk = w.startWalk;
export const promptOf = w.promptOf;
export const next = w.next;
export const choose = w.choose;
export const whereAmI = w.whereAmI;
