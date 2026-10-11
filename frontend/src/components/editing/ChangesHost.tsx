/**
 * 「変更点」ダイアログ: 保存する前に、読み込んだ (最後に保存した) 内容から何が変わったかを一覧で確かめる。
 * 編集の帯の「変更点」ボタンが合図を送り、いま開いているタブの文書の差を出す。保存はしない (読むだけ)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getActiveTabId } from "../../store/tabStore";
import { getChangeSource, SHOW_CHANGES_EVENT } from "../../utils/changeSource";
import { describePath, diffJson, formatValue, summarizeChanges, type Change, type ChangeKind } from "../../utils/jsonDiff";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import "../../styles/changesDialog.css";

const KIND_LABEL: Record<ChangeKind, string> = { added: "追加", removed: "削除", changed: "変更", reordered: "順序" };
const MAX_ROWS = 300;

function reorderedText(c: Change): string {
  const ids = (c.after as string[] | undefined) ?? [];
  return `並びが変わりました (${ids.length} 件)`;
}

export function ChangesDialog({ changes, onClose }: { changes: Change[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  const sum = summarizeChanges(changes);
  const shown = changes.slice(0, MAX_ROWS);
  return (
    <div className="changes-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="changes-dialog" role="dialog" aria-modal="true" aria-label="変更点" ref={ref} data-testid="changes-dialog">
        <div className="changes-head">
          <h2>変更点</h2>
          <span className="changes-sum" data-testid="changes-summary">
            {changes.length === 0 ? "変更はありません" : (
              [sum.added && `追加 ${sum.added}`, sum.changed && `変更 ${sum.changed}`, sum.removed && `削除 ${sum.removed}`, sum.reordered && `順序 ${sum.reordered}`].filter(Boolean).join(" / ")
            )}
          </span>
          <button type="button" className="changes-close" onClick={onClose} aria-label="閉じる"><i className="bi bi-x-lg" /></button>
        </div>
        <ul className="changes-list">
          {shown.map((c, i) => (
            <li key={i} className={`changes-row changes-row--${c.kind}`}>
              <span className="changes-kind">{KIND_LABEL[c.kind]}</span>
              <span className="changes-path">{describePath(c.path)}</span>
              <span className="changes-values">
                {c.kind === "changed" && (<><del>{formatValue(c.before)}</del><i className="bi bi-arrow-right" aria-label="から" /><ins>{formatValue(c.after)}</ins></>)}
                {c.kind === "added" && <ins>{formatValue(c.after)}</ins>}
                {c.kind === "removed" && <del>{formatValue(c.before)}</del>}
                {c.kind === "reordered" && <span>{reorderedText(c)}</span>}
              </span>
            </li>
          ))}
        </ul>
        {changes.length > MAX_ROWS && <p className="changes-more">ほか {changes.length - MAX_ROWS} 件 (先頭の {MAX_ROWS} 件だけを表示しています)</p>}
        <p className="changes-foot">読み込んだ (または最後に保存した) 内容と、いまの編集中の内容の差です。ここでは保存されません。</p>
      </div>
    </div>
  );
}

export function ChangesHost() {
  const [changes, setChanges] = useState<Change[] | null>(null);
  useEffect(() => {
    const open = () => {
      const src = getChangeSource(getActiveTabId());
      if (!src) return;
      setChanges(diffJson(src.getBefore(), src.getAfter()));
    };
    window.addEventListener(SHOW_CHANGES_EVENT, open);
    return () => window.removeEventListener(SHOW_CHANGES_EVENT, open);
  }, []);
  const close = useMemo(() => () => setChanges(null), []);
  // Esc は、画面の側の Esc (パネルを閉じる等) より先に受けて、このダイアログだけを閉じる。
  // 画面の側の listener は、あとから登録されるので、ここは開く前から (マウント時に) 登録しておく
  const openRef = useRef(false);
  openRef.current = changes !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !openRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setChanges(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  if (!changes) return null;
  return <ChangesDialog changes={changes} onClose={close} />;
}
