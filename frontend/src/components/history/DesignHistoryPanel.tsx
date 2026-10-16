/**
 * ヘッダーの「設計のあゆみ」ボタン。いま開いている設計の、変更の記録・版の比較・完了の確認・メモ・共有 (書き出し・ファイルの場所)・試作を、1 つのダイアログにまとめる。
 * 中身は大きい (設計書の書き出しなどを使う) ので、開いたときに読み込む。
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { useActiveTab } from "../../hooks/useActiveTab";
import { designOfTab } from "../../utils/designHistory";
import { useLastEditors } from "../../hooks/useLastEditors";
import { formatTime } from "../operations/reviewUtils";
import { onHeaderPanelRequest } from "../../utils/headerPanels";

const DesignHistoryDialog = lazy(() => import("./DesignHistoryDialog"));

export function DesignHistoryPanel() {
  const tab = useActiveTab();
  const design = designOfTab(tab?.type, tab?.resourceId);
  // どの設計で開いたかを覚える (別のタブへ移ったら、閉じた扱いになり、別の設計のタブで勝手に開かない)
  const key = design ? `${design.kind}:${design.id}` : "";
  const [openFor, setOpenFor] = useState("");
  const open = !!key && openFor === key;
  const setOpen = (v: boolean) => setOpenFor(v ? key : "");
  const last = useLastEditors(!!design).get(key);
  useEffect(() => onHeaderPanelRequest("history", () => setOpenFor(key)), [key]);
  if (!design) return null;
  return (
    <>
      <button type="button" className="common-header-icon-btn" data-testid="history-open" title={`この設計のあゆみ (変更の記録・版の比較・完了の確認・メモ・書き出し)${last ? ` — 最後に編集: ${last.actor}${last.via === "ai" ? " (AI)" : ""} ${formatTime(last.at)}` : ""}`} aria-label={`この設計のあゆみ${last ? `。最後に編集: ${last.actor}` : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <i className="bi bi-clock-history" />
      </button>
      {open && design && (
        <Suspense fallback={null}>
          <DesignHistoryDialog design={design} label={tab?.label ?? design.id} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
