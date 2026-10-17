/**
 * 図 (ER 図・画面フロー) の、拡大縮小・全体表示・選択へ寄る・キーの操作を、そろえる (UI 改善提案 第 3 弾 #56)。
 * React Flow の図の子として置く。
 *   + / − = 拡大 / 縮小、0 = 等倍、F = 全体を収める、Z = 選んでいる部品へ寄る
 *   (図の上にフォーカスがあるときだけ。入力欄の中では効かない)
 * buttons=true なら、図の左下に、同じ操作のボタンと倍率を出す。
 */
import { motionMs } from "../../theme/motionPrefs";
import { useEffect } from "react";
import { Panel, useReactFlow, useStoreApi, useViewport } from "@xyflow/react";

/** 全体を収める設定。補間の長さは、動きを減らす設定を、呼ぶたびに読む */
const fit = () => ({ padding: 0.3, maxZoom: 1, duration: motionMs(200) }) as const;

export function DiagramControls({ buttons = true }: { buttons?: boolean }) {
  const { zoomIn, zoomOut, zoomTo, fitView, getNodes } = useReactFlow();
  const store = useStoreApi();
  const { zoom } = useViewport();

  const focusSelection = () => {
    const picked = getNodes().filter((n) => n.selected);
    if (picked.length > 0) fitView({ nodes: picked, padding: 0.8, maxZoom: 1.2, duration: motionMs(200) });
    else fitView(fit());
  };

  useEffect(() => {
    const root = store.getState().domNode;
    // 図の何もない所をクリックしたら、図にフォーカスを移す (キーが、この図に届くように)
    if (root && root.tabIndex < 0) root.tabIndex = 0;
    const focusOnPane = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".react-flow__pane") && !t.closest(".react-flow__node, .react-flow__edge")) root?.focus({ preventScroll: true });
    };
    root?.addEventListener("pointerdown", focusOnPane);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest(".react-flow") || t.closest("input, textarea, select, [contenteditable=true], [role=dialog], dialog")) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomIn({ duration: motionMs(150) }); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomOut({ duration: motionMs(150) }); }
      else if (e.key === "0") { e.preventDefault(); zoomTo(1, { duration: motionMs(150) }); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); fitView(fit()); }
      else if (e.key === "z" || e.key === "Z") { e.preventDefault(); focusSelection(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); root?.removeEventListener("pointerdown", focusOnPane); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- React Flow の関数は、描画のたびに変わらない
  }, []);

  if (!buttons) return null;
  return (
    <Panel position="bottom-left" className="diagram-controls" data-testid="diagram-controls">
      <button type="button" onClick={() => zoomOut({ duration: motionMs(150) })} title="縮小 (−)" aria-label="縮小"><i className="bi bi-dash-lg" /></button>
      <button type="button" className="diagram-zoom-level" onClick={() => zoomTo(1, { duration: motionMs(150) })} title="等倍に戻す (0)" aria-label={`倍率 ${Math.round(zoom * 100)}%。等倍に戻す`} data-testid="diagram-zoom-level">{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={() => zoomIn({ duration: motionMs(150) })} title="拡大 (+)" aria-label="拡大"><i className="bi bi-plus-lg" /></button>
      <button type="button" onClick={() => fitView(fit())} title="全体を収める (F)" aria-label="全体を収める" data-testid="diagram-fit"><i className="bi bi-arrows-fullscreen" /></button>
      <button type="button" onClick={focusSelection} title="選んでいる部品へ寄る (Z)" aria-label="選んでいる部品へ寄る"><i className="bi bi-crosshair" /></button>
    </Panel>
  );
}
