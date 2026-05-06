/**
 * 赤線 free-form マーカー オーバーレイ (#261)
 *
 * ProcessFlowEditor 上に被せる SVG オーバーレイ。描画モード ON で:
 * - ペンツール: ドラッグで自由描画。複数ストロークは path "d" 内で M 区切り合体
 *   色 / 太さ をツールバーで選択可能 (MarkerShape.color / strokeWidth に格納)
 * - 消しゴムツール: 既存 shape 付き marker をクリックで削除
 * - 確定ボタン: 現在のストローク群を 1 マーカー (kind=todo) として起票。
 *   ストローク中点の直下 DOM 要素から anchorStepId / anchorFieldPath を決定し、
 *   座標を anchor 要素の bbox 相対に変換 (anchor が取れなければ overlay 相対のまま保存)。
 * - キャンセルボタン: ストロークを破棄して描画モード終了
 *
 * 既存 marker の render:
 * - anchor あり: 要素の bbox 上に fixed 位置の SVG を配置、reflow/scroll/resize で追従
 * - anchor なし: 従来通り overlay 全体の SVG に描画
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Marker } from "../../types/action";
import { convertPathToAnchorRelative, strokesCenterInViewport } from "../../utils/markerAnchor";

type Tool = "pen" | "eraser";

/** ツールバーのプリセット色 (MarkerShape.color に保存される) */
const COLOR_PRESETS: Array<{ value: string; label: string }> = [
  { value: "#ef4444", label: "赤 (注意・重要)" },
  { value: "#f97316", label: "橙 (要確認)" },
  { value: "#3b82f6", label: "青 (質問・情報)" },
  { value: "#10b981", label: "緑 (補足・提案)" },
];
const DEFAULT_COLOR = COLOR_PRESETS[0].value;

const WIDTH_PRESETS: Array<{ value: number; label: string; icon: string }> = [
  { value: 2, label: "細線", icon: "bi-slash-lg" },
  { value: 4, label: "太線", icon: "bi-dash-lg" },
];
const DEFAULT_WIDTH = WIDTH_PRESETS[0].value;

interface CommitShape {
  type: "path";
  d: string;
  color?: string;
  strokeWidth?: number;
  anchorStepId?: string;
  anchorFieldPath?: string;
}

interface Props {
  markers: Marker[];
  drawing: boolean;
  /** 完成した shape を受け取り、body を聞いて marker を作る */
  onCommitStrokes: (shape: CommitShape) => void;
  /** eraser で既存 marker を消去 */
  onEraseMarker: (markerId: string) => void;
  /** 描画モード終了時のコールバック (キャンセル時、または commit 完了後) */
  onExitDrawing: () => void;
}

/**
 * anchor 付き marker の個別レンダラ。
 * 対象要素を querySelector で探し、bbox 上に fixed positioned な SVG を被せる。
 * reflow / scroll / resize を監視して位置追従。対象が無ければ null (orphan)。
 */
function AnchoredMarker({
  marker,
  eraserMode,
  onEraseMarker,
}: {
  marker: Marker;
  eraserMode: boolean;
  onEraseMarker: (id: string) => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const stepId = marker.shape?.anchorStepId;
    if (!stepId) return;
    const fieldPath = marker.shape?.anchorFieldPath;
    const selector = fieldPath
      ? `[data-step-id="${CSS.escape(stepId)}"] [data-field-path="${CSS.escape(fieldPath)}"]`
      : `[data-step-id="${CSS.escape(stepId)}"]`;

    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) {
          const r = el.getBoundingClientRect();
          // 0 幅/高さの要素 (非表示等) は orphan 扱い
          if (r.width > 0 && r.height > 0) { setRect(r); return; }
        }
        setRect(null);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    const mo = new MutationObserver(measure);
    // .process-flow-page 全体を観察 (.process-flow-editor-info の MarkerPanel 展開も含む)。
    // attributeFilter で style/class 変化のみに絞り、入力文字列の変更などノイズを避ける。
    const scope = document.querySelector(".process-flow-page") ?? document.body;
    mo.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [marker.shape?.anchorStepId, marker.shape?.anchorFieldPath]);

  const shape = marker.shape;
  if (!shape || !rect) return null;

  return (
    <svg
      className="drawing-anchored-shape"
      data-marker-id={marker.id}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: eraserMode ? "auto" : "none",
        zIndex: 30,
        overflow: "visible",
      }}
    >
      <path
        className="drawing-existing-shape"
        d={shape.d}
        stroke={shape.color ?? "#ef4444"}
        strokeWidth={shape.strokeWidth ?? 2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.75}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: eraserMode ? "stroke" : "none", cursor: eraserMode ? "pointer" : "default" }}
        onClick={(e) => {
          if (eraserMode) { e.stopPropagation(); onEraseMarker(marker.id); }
        }}
      >
        <title>{`[${marker.kind}] ${marker.body}${eraserMode ? " (クリックで削除)" : ""}`}</title>
      </path>
    </svg>
  );
}

export function DrawingOverlay({ markers, drawing, onCommitStrokes, onEraseMarker, onExitDrawing }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  // 完了した個別ストローク。各ストロークが確定時点の色・幅を保持することで、
  // 以降にツールバーで色・幅を切り替えても既存ストロークに影響が及ばない (#261 修正)
  const [strokes, setStrokes] = useState<Array<{ d: string; color: string; width: number }>>([]);
  const [currentStroke, setCurrentStroke] = useState<string>(""); // 描画中 (色・幅は現在の toolbar 設定)
  const isDrawingRef = useRef(false);

  // 描画モード終了時に state リセット
  useEffect(() => {
    if (!drawing) {
      isDrawingRef.current = false;
      setStrokes([]);
      setCurrentStroke("");
      setTool("pen");
      setColor(DEFAULT_COLOR);
      setWidth(DEFAULT_WIDTH);
    }
  }, [drawing]);

  const toPercent = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawing || tool !== "pen") return;
    const { x, y } = toPercent(e.clientX, e.clientY);
    isDrawingRef.current = true;
    setCurrentStroke(`M ${x.toFixed(2)} ${y.toFixed(2)}`);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing || tool !== "pen" || !isDrawingRef.current) return;
    const { x, y } = toPercent(e.clientX, e.clientY);
    setCurrentStroke((p) => `${p} L ${x.toFixed(2)} ${y.toFixed(2)}`);
  };

  const onPointerUp = () => {
    if (!drawing || tool !== "pen" || !isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (currentStroke && currentStroke.includes("L")) {
      // 確定時点の色・幅を固定して保存
      setStrokes((s) => [...s, { d: currentStroke, color, width }]);
    }
    setCurrentStroke("");
  };

  const commit = () => {
    if (strokes.length === 0) { onExitDrawing(); return; }
    // 各ストロークの d を連結 (複数 M セグメント = 1 marker)。
    // 色/幅は最新ストロークの値を採用 (ユーザーの最後の選択を尊重)。
    const d = strokes.map((s) => s.d).join(" ");
    const last = strokes[strokes.length - 1];
    const overlayEl = svgRef.current;
    const overlayRect = overlayEl?.getBoundingClientRect();

    let anchorStepId: string | undefined;
    let anchorFieldPath: string | undefined;
    let finalD = d;

    if (overlayEl && overlayRect) {
      const center = strokesCenterInViewport(strokes.map((s) => s.d), overlayRect);
      if (center) {
        // overlay 自身を pointer-events から除外して下の要素を取得
        const prevPE = overlayEl.style.pointerEvents;
        overlayEl.style.pointerEvents = "none";
        const el = document.elementFromPoint(center.x, center.y);
        overlayEl.style.pointerEvents = prevPE;
        if (el) {
          const stepEl = el.closest<HTMLElement>("[data-step-id]");
          if (stepEl) {
            anchorStepId = stepEl.dataset.stepId;
            const fieldEl = el.closest<HTMLElement>("[data-field-path]");
            // field は step 内のみ採用
            if (fieldEl && stepEl.contains(fieldEl)) {
              anchorFieldPath = fieldEl.dataset.fieldPath;
            }
            const anchorEl = anchorFieldPath ? (fieldEl as HTMLElement) : stepEl;
            finalD = convertPathToAnchorRelative(d, overlayRect, anchorEl.getBoundingClientRect());
          }
        }
      }
    }

    onCommitStrokes({
      type: "path",
      d: finalD,
      // デフォルトから変更されている時のみ保存 (既存 marker の shape を冗長化しない)
      color: last.color !== DEFAULT_COLOR ? last.color : undefined,
      strokeWidth: last.width !== DEFAULT_WIDTH ? last.width : undefined,
      anchorStepId,
      anchorFieldPath,
    });
    // ProcessFlowEditor 側が drawing=false にするので useEffect でリセットされる
  };

  const cancel = () => {
    setStrokes([]);
    setCurrentStroke("");
    onExitDrawing();
  };

  const undoLastStroke = () => {
    setStrokes((s) => s.slice(0, -1));
  };

  // 既存 marker を anchor 有無で分割
  const visibleMarkers = markers.filter((m) => m.shape && m.shape.type === "path" && !m.resolvedAt);
  const anchoredMarkers = visibleMarkers.filter((m) => m.shape?.anchorStepId);
  const floatingMarkers = visibleMarkers.filter((m) => !m.shape?.anchorStepId);

  const eraserMode = drawing && tool === "eraser";

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: drawing ? "auto" : "none",
    cursor: drawing ? (tool === "pen" ? "crosshair" : "not-allowed") : "default",
    zIndex: 30,
  };

  return (
    <>
      {/* anchor 付き marker (DOM 要素に追従) */}
      {anchoredMarkers.map((m) => (
        <AnchoredMarker key={m.id} marker={m} eraserMode={eraserMode} onEraseMarker={onEraseMarker} />
      ))}

      <svg
        ref={svgRef}
        className="drawing-overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={containerStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* anchor なし marker (overlay 全体の % で描画) */}
        {floatingMarkers.map((m) => {
          const s = m.shape!;
          return (
            <path
              key={m.id}
              className="drawing-existing-shape"
              d={s.d}
              stroke={s.color ?? "#ef4444"}
              strokeWidth={s.strokeWidth ?? 2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.75}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: eraserMode ? "stroke" : "none", cursor: eraserMode ? "pointer" : "default" }}
              onClick={(e) => {
                if (eraserMode) {
                  e.stopPropagation();
                  onEraseMarker(m.id);
                }
              }}
            >
              <title>{`[${m.kind}] ${m.body}${eraserMode ? " (クリックで削除)" : ""}`}</title>
            </path>
          );
        })}
        {/* 確定済みストローク (まだ commit 前、描画セッション内) — 各ストロークが個別の色/幅を保持 */}
        {strokes.map((s, i) => (
          <path
            key={`s-${i}`}
            d={s.d}
            stroke={s.color}
            strokeWidth={s.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* 描画中の path */}
        {currentStroke && (
          <path
            d={currentStroke}
            stroke={color}
            strokeWidth={width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* ツールバー (drawing 時のみ表示) */}
      {drawing && (
        <div className="drawing-toolbar">
          <div className="drawing-toolbar-group">
            <button
              type="button"
              className={`drawing-toolbar-btn ${tool === "pen" ? "active" : ""}`}
              onClick={() => setTool("pen")}
              title="ペン (ドラッグで描画)"
            >
              <i className="bi bi-pencil-fill" />
            </button>
            <button
              type="button"
              className={`drawing-toolbar-btn ${tool === "eraser" ? "active" : ""}`}
              onClick={() => setTool("eraser")}
              title="消しゴム (既存の赤線をクリックで削除)"
            >
              <i className="bi bi-eraser-fill" />
            </button>
          </div>
          {tool === "pen" && (
            <>
              <div className="drawing-toolbar-group drawing-toolbar-colors">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`drawing-color-swatch ${color === c.value ? "active" : ""}`}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setColor(c.value)}
                    title={c.label}
                    aria-label={c.label}
                    data-color={c.value}
                  />
                ))}
              </div>
              <div className="drawing-toolbar-group">
                {WIDTH_PRESETS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    className={`drawing-toolbar-btn drawing-width-btn ${width === w.value ? "active" : ""}`}
                    onClick={() => setWidth(w.value)}
                    title={`${w.label} (${w.value}px)`}
                    data-width={w.value}
                  >
                    <i className={`bi ${w.icon}`} style={{ fontSize: `${0.5 + w.value * 0.15}rem` }} />
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="drawing-toolbar-group">
            <button
              type="button"
              className="drawing-toolbar-btn"
              onClick={undoLastStroke}
              disabled={strokes.length === 0}
              title={`1 ストローク戻す (現在 ${strokes.length})`}
            >
              <i className="bi bi-arrow-counterclockwise" />
            </button>
          </div>
          <div className="drawing-toolbar-group">
            <span className="drawing-toolbar-info">
              {strokes.length} ストローク
            </span>
            <button
              type="button"
              className="drawing-toolbar-btn drawing-toolbar-commit"
              onClick={commit}
              disabled={strokes.length === 0}
              title="ストロークを確定して marker 起票"
            >
              <i className="bi bi-check-lg" /> 確定
            </button>
            <button
              type="button"
              className="drawing-toolbar-btn drawing-toolbar-cancel"
              onClick={cancel}
              title="破棄して描画モード終了"
            >
              <i className="bi bi-x-lg" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
