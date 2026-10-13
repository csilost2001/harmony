/**
 * 接続が切れて戻ったとき、編集中の内容をサーバ側の下書き (編集セッション) へ送り直す。
 *
 * 切れている間の変更は、下書きへの送信に失敗している (画面の内容と、ブラウザの下書きは残っている)。
 * 戻ったらすぐ反映して、ほかの人が見ている画面・保存の衝突の判定が、古い下書きのままにならないようにする。
 * push は、いま編集中の内容を下書きへ送る処理 (最新の内容を読む関数を渡す)。
 */
import { useEffect, useRef } from "react";
import { mcpBridge } from "../mcp/mcpBridge";

export function useResyncDraftOnReconnect(active: boolean, isDirty: boolean, push: () => void): void {
  const pushRef = useRef(push);
  const dirtyRef = useRef(isDirty);
  useEffect(() => { pushRef.current = push; dirtyRef.current = isDirty; });
  useEffect(() => {
    if (!active) return;
    return mcpBridge.onStatusChange((s) => {
      if (s === "connected" && dirtyRef.current) pushRef.current();
    });
  }, [active]);
}
