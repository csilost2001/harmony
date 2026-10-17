/**
 * 操作ツアー。画面の要素を順に光らせて、使い方を案内する (手順は utils/tours.ts)。
 * 開き方: コマンドパレット (Ctrl+K → 「>」→「ツアー」)。初めて開く画面では、ツアーがあることを一度だけ通知で知らせる。
 * 操作: → / Enter = 次へ、← = 前へ、Esc = 閉じる。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useActiveTab } from "../../hooks/useActiveTab";
import { onHeaderPanelRequest } from "../../utils/headerPanels";
import { WalkthroughDialog } from "./WalkthroughDialog";
import { tourForTab, type Tour as TourDef } from "../../utils/tours";
import { showToast } from "../../utils/toast";
import "../../styles/tour.css";

const SEEN_KEY = "harmony.tour.offered";

function readSeen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
function markSeen(id: string): void {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), id])])); } catch { /* 保存できなくても動作は妨げない */ }
}

/** 光らせる要素の位置 (画面の座標)。見つからなければ null */
function rectOf(selector: string | undefined): DOMRect | null {
  if (!selector) return null;
  try {
    const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((e) => e.offsetParent !== null || e.getClientRects().length > 0);
    if (!el) return null;
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0 ? null : r;
  } catch { return null; }
}

export function TourHost() {
  const tab = useActiveTab();
  const [tour, setTour] = useState<TourDef | null>(null);
  const [walkthrough, setWalkthrough] = useState(false);
  useEffect(() => onHeaderPanelRequest("walkthrough", () => setWalkthrough(true)), []);

  // コマンド「この画面の操作ツアー」で始める。いまのタブのツアーを開く
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; });
  useEffect(() => onHeaderPanelRequest("tour", () => {
    const t = tourForTab(tabRef.current?.type);
    if (t) { markSeen(t.id); setTour(t); } else showToast("この画面には、操作ツアーがありません", "info");
  }), []);

  // 初めて開く画面で、ツアーがあることを、一度だけ知らせる (勝手には始めない)
  useEffect(() => {
    const t = tourForTab(tab?.type);
    if (!t || readSeen().includes(t.id)) return;
    markSeen(t.id);
    const timer = setTimeout(() => showToast(`「${t.title}」の操作ツアーがあります (Ctrl+K → 「>」→「ツアー」)`, "info"), 1200);
    return () => clearTimeout(timer);
  }, [tab?.type]);

  return (<>
    {tour && <TourOverlay tour={tour} onClose={() => setTour(null)} />}
    {walkthrough && <WalkthroughDialog onClose={() => setWalkthrough(false)} />}
  </>);
}

export function TourOverlay({ tour, onClose }: { tour: TourDef; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef);
  const step = tour.steps[index];
  const last = index === tour.steps.length - 1;

  const measure = useCallback(() => setRect(rectOf(step.target)), [step.target]);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 手順が変わるたびに、光らせる要素の位置を測り直す
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" || (e.key === "Enter" && !(e.target instanceof HTMLButtonElement))) { e.preventDefault(); if (last) onClose(); else setIndex((i) => i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [last, onClose]);

  // 説明のカードは、光らせた要素の下 (入らなければ上)。要素が無ければ中央
  const cardStyle: React.CSSProperties = rect
    ? { top: Math.min(window.innerHeight - 190, Math.max(8, rect.bottom + 12 + 170 > window.innerHeight ? rect.top - 182 : rect.bottom + 12)), left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 368)) }
    : { top: "30%", left: "50%", transform: "translateX(-50%)" };

  return (
    <div className="tour-root" data-testid="tour">
      <div className="tour-mask" onMouseDown={onClose} />
      {rect && <div className="tour-spot" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }} data-testid="tour-spot" />}
      <div ref={cardRef} className="tour-card" style={cardStyle} role="dialog" aria-modal="true" aria-label={`${tour.title}の操作ツアー`} data-testid="tour-card">
        <div className="tour-step">{tour.title}の操作ツアー ({index + 1} / {tour.steps.length})</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose} data-testid="tour-close">閉じる</button>
          <span className="tour-spacer" />
          <button type="button" className="btn btn-sm btn-secondary" disabled={index === 0} onClick={() => setIndex((i) => i - 1)} data-testid="tour-prev">前へ</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => (last ? onClose() : setIndex((i) => i + 1))} data-testid="tour-next" autoFocus>{last ? "終わる" : "次へ"}</button>
        </div>
      </div>
    </div>
  );
}
