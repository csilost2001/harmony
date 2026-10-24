/** 「流れ」表示の、表示まわりの共有状態 (変数の選び・表示の細かさ・その場で直す窓口) */
import { createContext, useContext } from "react";
import type { ActionDefinition } from "../../../types/v3";
import type { StepChipCtx, StoryCtx } from "./storyModel";

/** その場で直すための窓口 (編集中だけ。閲覧中は null) */
export interface StoryEditApi {
  /** 編集中の下書きのアクションを直す (ひとまとまりの取り消し単位) */
  mutate: (fn: (action: ActionDefinition) => void) => void;
  /** 直前の操作を取り消す (編集セッションの取り消し) */
  undo?: () => void;
  /** 流れ全体で使われている ID (新しい工程の ID が重ならないように) */
  flowIds: () => Set<string>;
  tables: ReadonlyArray<{ id: string; name: string; physicalName: string; /** 1 行を決める列の組 (主キー・一意) */ uniqueKeys?: ReadonlyArray<readonly string[]> }>;
  /** 処理の外から来る値 (セッションなど)。条件の候補に出す */
  ambient?: ReadonlyArray<{ name: string; label?: string }>;
  /** 処理フローに登録された外部システムの名前 (接続先の候補) */
  externalSystems?: readonly string[];
  /** 「日本語で頼む」: AI に、下書きの変更を頼む (あれば) */
  askAi?: (prompt: string) => void;
}

/** 挿入した直後に、自動で開く欄 */
export interface AutoEdit {
  stepId: string;
  what: "desc" | "table" | "cond" | "response" | "decision";
  /** 条件の場合の、腕の id */
  armId?: string;
}

export interface StoryUi {
  ctx: StoryCtx;
  /** 「実装」のとき、変数は名前で出す */
  showNames: boolean;
  activeVar: string | null;
  setActiveVar: (name: string | null) => void;
  edit: StoryEditApi | null;
  autoEdit: AutoEdit | null;
}

const Ctx = createContext<StoryUi | null>(null);
export const StoryUiProvider = Ctx.Provider;
/** 全部入り (アクション全体を含む。操作のたびに変わる)。直す窓・判定表など、アクション全体を読むところだけが使う */
export function useStoryUi(): StoryUi {
  const v = useContext(Ctx);
  if (!v) throw new Error("StoryUiProvider が必要です");
  return v;
}

/**
 * 行の描画に要るものだけ。アクション全体を含まないので、直した工程のほかの行は、これが変わらず、描き直さずに済む (React.memo)。
 * 変わるとき: 呼び名の内容・応答の一覧・表示の細かさ・選んだ変数・編集の入り切り など (工程の中身ではない)。
 */
export interface StoryRowUi {
  ctx: StepChipCtx;
  showNames: boolean;
  activeVar: string | null;
  setActiveVar: (name: string | null) => void;
  edit: StoryEditApi | null;
  /** いまのアクション全体 (押したときに読む。描画には使わない — 変わっても行は描き直されない) */
  getAction: () => StoryCtx["action"];
}
const RowCtx = createContext<StoryRowUi | null>(null);
export const StoryRowUiProvider = RowCtx.Provider;
export function useRowUi(): StoryRowUi {
  const v = useContext(RowCtx);
  if (!v) throw new Error("StoryRowUiProvider が必要です");
  return v;
}
