/**
 * 並べて表示の右ペイン。同じアプリをもう 1 つ (iframe で、`?pane=1`) 開き、別の設計を左のタブと並べて見る・編集する。
 * 右ペインは、別のブラウザのタブと同じ扱い: 編集のロック・下書きは別々で、一方の保存はもう一方へ通知される
 * (編集していなければ自動で読み直す)。キー操作 (Ctrl+S など) は、フォーカスのある側だけに効く。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { parsePaneMessage } from "../../utils/paneMode";
import { setSplit, type SplitTarget } from "../../store/splitStore";
import "../../styles/split.css";

interface Props {
  wsId: string;
  target: SplitTarget;
  /** 右ペインの設計を、左のタブとして開く (右ペインは閉じる)。path は、右ペインでいま開いているパス */
  onOpenInMain: (path: string) => void;
  /** 左と右を入れ替える */
  onSwap: (path: string) => void;
}

export function SplitPane({ wsId, target, onOpenInMain, onSwap }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [dirty, setDirty] = useState(false);
  // 右ペインの中で、いま開いているパス (中で別の画面へ移ったとき、閉じる・入れ替えが、いまの画面を対象にできるように)
  const [current, setCurrent] = useState(target.path);
  const src = `/w/${encodeURIComponent(wsId)}${target.path}${target.path.includes("?") ? "&" : "?"}pane=1`;

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frameRef.current?.contentWindow) return; // この右ペインの中からだけ
      const msg = parsePaneMessage(ev);
      if (!msg) return;
      if (msg.type === "harmony-pane-dirty") setDirty(msg.dirty);
      else {
        const prefix = `/w/${wsId}`;
        if (msg.path.startsWith(`${prefix}/`)) setCurrent(msg.path.slice(prefix.length).split("?")[0]);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [wsId]);

  const confirmDiscard = useCallback(() => !dirty || window.confirm("右側に、保存していない編集があります。このまま閉じても、編集中の内容は下書きに残ります (あとで開き直すと続きから編集できます)。閉じますか?"), [dirty]);

  return (
    <aside className="split-pane" aria-label="並べて表示 (右側)" data-testid="split-pane">
      <header className="split-pane-head">
        <i className="bi bi-layout-sidebar-inset-reverse" aria-hidden="true" />
        <span className="split-pane-title" title={target.label}>{target.label}</span>
        {dirty && <span className="split-pane-dirty" data-testid="split-pane-dirty">未保存</span>}
        <span className="split-pane-spacer" />
        <button type="button" className="split-pane-btn" onClick={() => onSwap(current)} title="左のタブと入れ替える" data-testid="split-swap"><i className="bi bi-arrow-left-right" /> 入れ替え</button>
        <button type="button" className="split-pane-btn" onClick={() => { if (confirmDiscard()) onOpenInMain(current); }} title="この画面を、左のタブとして開く (右側は閉じる)" data-testid="split-open-main"><i className="bi bi-box-arrow-in-left" /> 左で開く</button>
        <button type="button" className="split-pane-btn" aria-label="並べて表示を閉じる" onClick={() => { if (confirmDiscard()) setSplit(wsId, null); }} title="右側を閉じる" data-testid="split-close"><i className="bi bi-x-lg" /></button>
      </header>
      <iframe ref={frameRef} className="split-pane-frame" src={src} title={`並べて表示: ${target.label}`} data-testid="split-frame" />
    </aside>
  );
}
