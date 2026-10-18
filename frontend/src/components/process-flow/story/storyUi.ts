/** 「流れ」表示の、表示まわりの共有状態 (変数の選び・表示の細かさ) */
import { createContext, useContext } from "react";
import type { StoryCtx } from "./storyModel";

export interface StoryUi {
  ctx: StoryCtx;
  /** 「実装」のとき、変数は名前で出す */
  showNames: boolean;
  activeVar: string | null;
  setActiveVar: (name: string | null) => void;
}

const Ctx = createContext<StoryUi | null>(null);
export const StoryUiProvider = Ctx.Provider;
export function useStoryUi(): StoryUi {
  const v = useContext(Ctx);
  if (!v) throw new Error("StoryUiProvider が必要です");
  return v;
}
