/** 「流れ」表示の、表示まわりの共有状態 (変数の選び・表示の細かさ・その場で直す窓口) */
import { createContext, useContext } from "react";
import type { ActionDefinition } from "../../../types/v3";
import type { StoryCtx } from "./storyModel";

/** その場で直すための窓口 (編集中だけ。閲覧中は null) */
export interface StoryEditApi {
  /** 編集中の下書きのアクションを直す (ひとまとまりの取り消し単位) */
  mutate: (fn: (action: ActionDefinition) => void) => void;
  /** 直前の操作を取り消す (編集セッションの取り消し) */
  undo?: () => void;
  /** 流れ全体で使われている ID (新しい工程の ID が重ならないように) */
  flowIds: () => Set<string>;
  tables: ReadonlyArray<{ id: string; name: string; physicalName: string }>;
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
export function useStoryUi(): StoryUi {
  const v = useContext(Ctx);
  if (!v) throw new Error("StoryUiProvider が必要です");
  return v;
}
