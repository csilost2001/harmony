import { useEffect, useRef } from "react";
import { registerPageCommands, type PageCommand } from "../store/pageCommands";

/**
 * この画面の操作を、コマンドパレットに載せる。画面を閉じると外れる。
 * commands は毎回新しく作ってよい (実行のときは、いちばん新しいものを使う)。
 */
export function usePageCommands(owner: string, commands: readonly PageCommand[]): void {
  const ref = useRef(commands);
  useEffect(() => { ref.current = commands; });
  useEffect(() => registerPageCommands(owner, () => ref.current), [owner]);
}
