import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
export const KEYBOARD_MOVE_SETTLE_MS = 400;

/**
 * React Flow の図 (画面フロー図・ER 図) で、ノードをキーボード (矢印キー) で動かしたあとの位置を保存へ回す。
 * React Flow は、矢印キーでの移動を onNodeDragStop に通知しない (ドラッグのときだけ通知する) ので、
 * そのままでは「動いて見えるが、保存されない」ことになる。矢印キーの操作が落ち着いたら (連続した押下は 1 回にまとめる)、
 * 選択中のノードの位置で `commit` を呼ぶ。返す関数は、図を包む要素の onKeyUp に渡す。
 */
export function useKeyboardNodeMove<N extends { selected?: boolean }>(getNodes: () => readonly N[], commit: (selected: N[]) => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getRef = useRef(getNodes);
  const commitRef = useRef(commit);
  useEffect(() => { getRef.current = getNodes; commitRef.current = commit; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (!enabled || !ARROWS.has(e.key)) return;
    // ノードにフォーカスがあるときだけ (入力欄の中の矢印キー・図の外は対象外)
    if (!(e.target as HTMLElement).closest?.(".react-flow__node")) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const selected = getRef.current().filter((n) => n.selected);
      if (selected.length > 0) commitRef.current(selected);
    }, KEYBOARD_MOVE_SETTLE_MS);
  }, [enabled]);
}
