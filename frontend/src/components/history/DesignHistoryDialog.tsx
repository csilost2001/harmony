/**
 * 設計のあゆみ (UI 改善提案 続編 第 9 弾 #162〜#164・#171〜#173・#178・#179)。いま開いている設計 1 件の、
 * 変更の記録 / 版の比較 / 完了の確認 / メモ / 共有 / 試作。原本は書き換えない (メモと試作は、このブラウザにだけ残す)。
 */
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { HISTORY_KIND_LABELS, type TabDesign } from "../../utils/designHistory";
import { HistoryTimelineTab } from "./HistoryTimelineTab";
import { HistoryCompareTab, type CompareSelection } from "./HistoryCompareTab";
import { HistoryChecklistTab } from "./HistoryChecklistTab";
import { HistoryMemoTab } from "./HistoryMemoTab";
import { HistoryShareTab } from "./HistoryShareTab";
import { HistoryTrialTab } from "./HistoryTrialTab";
import "../../styles/pasteColumns.css";
import "../../styles/docTemplate.css";
import "../../styles/analysis.css";
import "../../styles/operations.css";
import "../../styles/designHistory.css";

type Tab = "timeline" | "compare" | "checklist" | "memo" | "share" | "trial";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "timeline", label: "変更の記録" }, { id: "compare", label: "版を比べる" }, { id: "checklist", label: "完了の確認" },
  { id: "memo", label: "メモ" }, { id: "share", label: "共有・書き出し" }, { id: "trial", label: "試作" },
];

interface Props { design: TabDesign; label: string; onClose: () => void }

export default function DesignHistoryDialog({ design, label, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [tab, setTab] = useState<Tab>("timeline");
  const [selection, setSelection] = useState<CompareSelection | undefined>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={trapRef} className="paste-cols-modal dt-modal dh-modal" role="dialog" aria-modal="true" aria-label="設計のあゆみ" data-testid="design-history-dialog">
        <div className="paste-cols-head">
          <h2><i className="bi bi-clock-history" /> {HISTORY_KIND_LABELS[design.kind]}「{label}」のあゆみ <code className="dh-id">{design.id}</code></h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <nav className="dt-tabs" role="tablist" aria-label="あゆみの種類">
          {TABS.map((x) => <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)} data-testid={`dh-tab-${x.id}`}>{x.label}</button>)}
        </nav>
        <div className="paste-cols-body dh-body">
          {tab === "timeline" && <HistoryTimelineTab design={design} onCompare={() => setTab("compare")} />}
          {tab === "compare" && <HistoryCompareTab design={design} label={label} selection={selection} />}
          {tab === "checklist" && <HistoryChecklistTab design={design} />}
          {tab === "memo" && <HistoryMemoTab design={design} label={label} />}
          {tab === "share" && <HistoryShareTab design={design} label={label} />}
          {tab === "trial" && <HistoryTrialTab design={design} onCompare={(sel) => { setSelection(sel); setTab("compare"); }} />}
        </div>
      </div>
    </div>
  );
}
