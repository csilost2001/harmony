/**
 * 図 (ER 図・画面フロー) の道具 (UI 改善提案 続編 第 7 弾)。ReactFlow の子として置く (図の右上)。
 *   検索 (Ctrl+F)・つながりの強調・整列と等間隔・表示の絞り込み (関連 N 段・線の形と種類・ER のカラム・グループ)・凡例・
 *   書き出し (PNG・Mermaid・PlantUML・印刷)・基準との差分。
 * 見え方は useDiagramView が持ち、ここは操作の画面だけ。座標を動かす操作 (整列・等間隔) は、onMoved で保存へ回す。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel, getNodesBounds, useReactFlow, type Node } from "@xyflow/react";
import { buildDiagramText, type DiagramFormat, type DesignDocInput } from "@harmony/shared";
import { subsetInput } from "../../utils/diagramSubset";
import type { DiagramViewApi } from "../../hooks/useDiagramView";
import { ALIGN_LABELS, alignNodes, distributeNodes, neighborIds, type AlignMode } from "../../utils/diagramGeom";
import { COLUMN_MODE_LABELS, EDGE_SHAPE_LABELS, type ColumnMode, type EdgeShape } from "../../utils/diagramView";
import { buildPrintDocument, diagramToPngDataUrl, downloadDataUrl, PAPER_SIZES, printHtmlDocument, type Orientation, type PaperSize } from "../../utils/diagramExport";
import { toGeom } from "../../hooks/useSnapGuides";
import { loadDesignInput } from "../document/loadDesignInput";
import { writeClipboardText } from "../../utils/tableExport";
import { reportFailure } from "../../utils/failureToast";
import { showToast } from "../../utils/toast";
import { isImeComposing, isPlainEnter } from "../../utils/imeKeys";
import "../../styles/diagramTools.css";

export interface LegendItem { kind: "line" | "dashed" | "icon" | "box"; label: string; icon?: string; className?: string }

interface Props {
  /** 印刷の見出し (例: ER 図) */
  title: string;
  /** 書き出すファイルの名前 (英数字。日本語のファイル名は、ブラウザが無視することがある) */
  fileStem?: string;
  /** Mermaid / PlantUML の対象 (無ければ、文の書き出しは出さない) */
  textKind?: "er" | "screenFlow";
  api: DiagramViewApi;
  /** 画面に出ているノード (座標を動かす操作に使う) */
  nodes: Node[];
  readOnly: boolean;
  /** 整列・等間隔で動いたノード (新しい位置を入れたもの)。保存へ回す。無ければ、整列は出さない */
  onMoved?: (moved: Node[]) => void;
  onNodesChange: (updater: (nodes: Node[]) => Node[]) => void;
  edgeKinds: Array<{ id: string; label: string }>;
  legend: LegendItem[];
  /** ER: カラムの表示を選べる */
  columnModes?: boolean;
  /** 画面フロー: 折りたためるグループ */
  groups?: Array<{ id: string; label: string }>;
  /** 画面フローの自動配置など、図ごとの操作 */
  extraButtons?: ReactNode;
  /** 図を包む要素 (画像化の対象) */
  canvasRef: React.RefObject<HTMLElement | null>;
}

type Menu = null | "search" | "focus" | "align" | "view" | "legend" | "export";

export function DiagramTools({ title, fileStem = "diagram", textKind, api, nodes, readOnly, onMoved, onNodesChange, edgeKinds, legend, columnModes, groups, extraButtons, canvasRef }: Props) {
  const { setCenter, getZoom, fitView, getNodes, getEdges } = useReactFlow();
  const [menu, setMenu] = useState<Menu>(null);
  const [cursorState, setCursorState] = useState<{ key: string; i: number }>({ key: "", i: 0 });
  const [paper, setPaper] = useState<PaperSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { view, update, decorated } = api;

  const selected = useMemo(() => nodes.filter((n) => n.selected && !n.hidden), [nodes]);
  // 同じ親 (グループ) の中のノードどうしだけ、整列できる
  const sameParent = new Set(selected.map((n) => n.parentId ?? "")).size <= 1;
  const toggleMenu = (m: Exclude<Menu, null>) => setMenu((cur) => (cur === m ? null : m));

  // Ctrl+F: 図の中の検索 (この図が見えているときだけ。ブラウザの検索は開かない)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F"))) return;
      const root = rootRef.current;
      if (!root || root.getClientRects().length === 0) return;
      e.preventDefault();
      setMenu("search");
      setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select(); }, 0);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ] / [ : 選んでいるノードから、つながっている次の / 前のノードへ移る (キーボードで、図のつながりをたどる)
  const trail = useRef<string[]>([]);
  const nav = useRef<{ from: string; i: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "]" && e.key !== "[") || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".react-flow") || t.closest("input, textarea, select, [contenteditable=true], [role=dialog], dialog")) return;
      const root = rootRef.current;
      if (!root || root.getClientRects().length === 0) return;
      const picked = getNodes().filter((n) => n.selected && !n.hidden);
      if (picked.length !== 1) return;
      e.preventDefault();
      const cur = picked[0];
      let targetId: string | undefined;
      if (e.key === "[") {
        targetId = trail.current.pop();
        if (!targetId) { showToast("戻る先がありません", "info"); return; }
      } else {
        const visible = getNodes().filter((n) => !n.hidden).map((n) => n.id);
        const list = neighborIds(getEdges(), cur.id, visible).filter((id) => visible.includes(id));
        if (list.length === 0) { showToast("つながっているものがありません", "info"); return; }
        // 同じノードから続けて押すと、つながり先を順に回る
        const i = nav.current && nav.current.from === cur.id ? (nav.current.i + 1) % list.length : 0;
        nav.current = { from: cur.id, i };
        targetId = list[i];
        trail.current.push(cur.id);
        if (trail.current.length > 50) trail.current.shift();
      }
      const id = targetId;
      onNodesChange((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      const n = getNodes().find((x) => x.id === id);
      if (n) {
        const parent = n.parentId ? getNodes().find((p) => p.id === n.parentId) : undefined;
        setCenter((parent?.position.x ?? 0) + n.position.x + (n.measured?.width ?? 160) / 2, (parent?.position.y ?? 0) + n.position.y + (n.measured?.height ?? 60) / 2, { zoom: Math.max(getZoom(), 0.8), duration: 200 });
        setTimeout(() => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id!)}"]`)?.focus({ preventScroll: true }), 0);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [getNodes, getEdges, onNodesChange, setCenter, getZoom]);

  // 一致したノードへ寄る (何件目かは、一致の並びごとに持つ。検索語が変わったら、先頭に戻る)
  const matches = decorated.matchIds;
  const matchKey = matches.join("\n");
  const cursor = cursorState.key === matchKey ? cursorState.i : 0;
  const centerOn = useCallback((at: number) => {
    const n = getNodes().find((x) => x.id === matches[at]);
    if (!n) return;
    const abs = n.parentId ? { x: n.position.x + (getNodes().find((p) => p.id === n.parentId)?.position.x ?? 0), y: n.position.y + (getNodes().find((p) => p.id === n.parentId)?.position.y ?? 0) } : n.position;
    const w = n.measured?.width ?? 160, h = n.measured?.height ?? 60;
    setCenter(abs.x + w / 2, abs.y + h / 2, { zoom: Math.max(getZoom(), 0.8), duration: 200 });
  }, [matches, getNodes, setCenter, getZoom]);
  const goTo = useCallback((i: number) => {
    if (matches.length === 0) return;
    const at = ((i % matches.length) + matches.length) % matches.length;
    setCursorState({ key: matchKey, i: at });
    centerOn(at);
  }, [matches, matchKey, centerOn]);

  // 検索語が変わって一致する先頭が変わったら、先頭へ寄る
  useEffect(() => {
    if (view.search.trim() !== "" && matches.length > 0) centerOn(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 一致の並びが変わったときだけ
  }, [matchKey]);

  // ── 整列・等間隔 ──
  const applyMoves = (moves: Map<string, { x: number; y: number }>) => {
    if (moves.size === 0) { showToast("すでにそろっています", "info"); return; }
    onNodesChange((nds) => nds.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n)));
    onMoved?.(selected.filter((n) => moves.has(n.id)).map((n) => ({ ...n, position: moves.get(n.id)! })));
  };
  const align = (mode: AlignMode) => applyMoves(alignNodes(selected.map(toGeom), mode));
  const distribute = (axis: "x" | "y") => applyMoves(distributeNodes(selected.map(toGeom), axis));

  // ── 書き出し ──
  const exportPng = async () => {
    const root = canvasRef.current?.querySelector<HTMLElement>(".react-flow") ?? canvasRef.current;
    if (!root) return;
    setBusy(true);
    try {
      const visible = getNodes().filter((n) => !n.hidden);
      if (visible.length === 0) { showToast("書き出す図がありません", "info"); return; }
      const url = await diagramToPngDataUrl(root, getNodesBounds(visible));
      downloadDataUrl(`${fileStem}.png`, url);
    } catch (e) { reportFailure(e, `${title}の画像の書き出し`); } finally { setBusy(false); }
  };
  const printIt = async () => {
    const root = canvasRef.current?.querySelector<HTMLElement>(".react-flow") ?? canvasRef.current;
    if (!root) return;
    setBusy(true);
    try {
      const visible = getNodes().filter((n) => !n.hidden);
      if (visible.length === 0) { showToast("印刷する図がありません", "info"); return; }
      const url = await diagramToPngDataUrl(root, getNodesBounds(visible));
      printHtmlDocument(buildPrintDocument({ title, imageUrl: url, paper, orientation }));
    } catch (e) { reportFailure(e, `${title}の印刷`); } finally { setBusy(false); }
  };
  const copyText = async (format: DiagramFormat, onlySelected: boolean) => {
    if (!textKind) return;
    setBusy(true);
    try {
      const { input } = await loadDesignInput();
      const src: DesignDocInput = onlySelected ? subsetInput(input, textKind, new Set(selected.map((n) => n.id))) : input;
      const text = buildDiagramText(src, { kind: textKind }, format);
      if (!text) { showToast("書き出せる内容がありません", "info"); return; }
      const ok = await writeClipboardText(text);
      showToast(ok ? `${format === "mermaid" ? "Mermaid" : "PlantUML"} の図をコピーしました${onlySelected ? ` (選んだ ${selected.length} 件)` : ""}` : "コピーできませんでした (ブラウザがクリップボードを許可していません)", ok ? "info" : "error");
    } catch (e) { reportFailure(e, `${title}のコピー`); } finally { setBusy(false); }
  };

  const hiddenLine = decorated.hiddenNodeCount + decorated.hiddenEdgeCount > 0;
  const btn = (m: Exclude<Menu, null>, icon: string, label: string, on = false, testId?: string) => (
    <button type="button" className={`dgm-btn${menu === m ? " is-open" : ""}${on ? " is-on" : ""}`} onClick={() => toggleMenu(m)} aria-haspopup="true" aria-expanded={menu === m} title={label} aria-label={label} data-testid={testId ?? `dgm-${m}`}>
      <i className={`bi ${icon}`} />
    </button>
  );

  return (
    <Panel position="top-right" className="dgm-tools" data-testid="diagram-tools">
      <div ref={rootRef} className="dgm-bar" role="toolbar" aria-label={`${title}の道具`}>
        {btn("search", "bi-search", "図の中を検索 (Ctrl+F)", view.search !== "")}
        {btn("focus", "bi-bezier2", "選んだものとつながるものを強調", view.focus > 0)}
        {onMoved && btn("align", "bi-distribute-horizontal", "整列・等間隔", false)}
        {btn("view", "bi-sliders", "表示の絞り込み・線の形", hiddenLine || view.edgeShape !== "default" || view.hiddenKinds.length > 0 || view.columnMode !== "default" || view.collapsedGroups.length > 0)}
        {btn("legend", "bi-info-circle", "凡例")}
        {btn("export", "bi-download", "書き出し・印刷・基準との差分", view.diff)}
        {extraButtons}
      </div>

      {menu === "search" && (
        <div className="dgm-pop" role="group" aria-label="図の中を検索">
          <input ref={searchRef} className="dgm-input" type="search" value={view.search} placeholder="例: 注文、order" aria-label="図の中を検索" data-testid="dgm-search-input"
            onChange={(e) => { update({ search: e.target.value }); }}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (isPlainEnter(e) || (e.key === "Enter" && e.shiftKey && !isImeComposing(e))) { e.preventDefault(); goTo(cursor + (e.shiftKey ? -1 : 1)); }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); update({ search: "" }); setMenu(null); }
            }} />
          <div className="dgm-pop-row" aria-live="polite" data-testid="dgm-search-count">
            {view.search.trim() === "" ? "名前や ID の一部で探します。Enter で次へ、Shift+Enter で前へ" : matches.length === 0 ? "一致するものがありません" : `${matches.length} 件が一致 (${cursor + 1} 件目)`}
          </div>
          <div className="dgm-pop-row">
            <button type="button" className="dgm-small" onClick={() => goTo(cursor - 1)} disabled={matches.length < 2}>前へ</button>
            <button type="button" className="dgm-small" onClick={() => goTo(cursor + 1)} disabled={matches.length < 2}>次へ</button>
            <button type="button" className="dgm-small" onClick={() => { update({ search: "" }); }} disabled={view.search === ""}>クリア</button>
          </div>
        </div>
      )}

      {menu === "focus" && (
        <div className="dgm-pop" role="group" aria-label="つながりの強調">
          <div className="dgm-pop-row">選んだノードと、つながるものを濃くし、ほかを薄くします。</div>
          <div className="dgm-pop-row" role="radiogroup" aria-label="強調する段数">
            {([[0, "しない"], [1, "1 段"], [2, "2 段"]] as const).map(([v, l]) => (
              <label key={v} className={`dgm-choice${view.focus === v ? " is-on" : ""}`}><input type="radio" name="dgm-focus" checked={view.focus === v} onChange={() => update({ focus: v })} data-testid={`dgm-focus-${v}`} /> {l}</label>
            ))}
          </div>
          {view.focus > 0 && selected.length === 0 && <div className="dgm-pop-row dgm-muted">ノードを選ぶと強調されます。</div>}
        </div>
      )}

      {menu === "align" && (
        <div className="dgm-pop" role="group" aria-label="整列・等間隔">
          {readOnly ? <div className="dgm-pop-row dgm-muted">編集を始めると、整列できます。</div> : (
            <>
              <div className="dgm-pop-row dgm-muted">{selected.length < 2 ? "2 つ以上のノードを選んでください (Ctrl / Shift+クリック、または範囲選択)。" : !sameParent ? "グループの中と外のノードは、いっしょに整列できません。" : `${selected.length} 件を選択中`}</div>
              <div className="dgm-grid">
                {(Object.keys(ALIGN_LABELS) as AlignMode[]).map((m) => (
                  <button key={m} type="button" className="dgm-small" onClick={() => align(m)} disabled={selected.length < 2 || !sameParent} data-testid={`dgm-align-${m}`}>{ALIGN_LABELS[m]}</button>
                ))}
                <button type="button" className="dgm-small" onClick={() => distribute("x")} disabled={selected.length < 3 || !sameParent} data-testid="dgm-distribute-x">横に等間隔</button>
                <button type="button" className="dgm-small" onClick={() => distribute("y")} disabled={selected.length < 3 || !sameParent} data-testid="dgm-distribute-y">縦に等間隔</button>
              </div>
              <div className="dgm-pop-row dgm-muted">ドラッグ中は、ほかのノードの端・中央にそろうとガイド線が出ます (Shift を押している間は吸い付きません)。Ctrl+Z で戻せます。</div>
            </>
          )}
        </div>
      )}

      {menu === "view" && (
        <div className="dgm-pop" role="group" aria-label="表示の絞り込み・線の形">
          <label className="dgm-field">線の形
            <select value={view.edgeShape} onChange={(e) => update({ edgeShape: e.target.value as EdgeShape })} data-testid="dgm-edge-shape">
              {(Object.keys(EDGE_SHAPE_LABELS) as EdgeShape[]).map((s) => <option key={s} value={s}>{EDGE_SHAPE_LABELS[s]}</option>)}
            </select>
          </label>
          {edgeKinds.length > 1 && (
            <fieldset className="dgm-fieldset"><legend>線の種類</legend>
              {edgeKinds.map((k) => (
                <label key={k.id} className="dgm-check"><input type="checkbox" checked={!view.hiddenKinds.includes(k.id)} onChange={(e) => update({ hiddenKinds: e.target.checked ? view.hiddenKinds.filter((x) => x !== k.id) : [...view.hiddenKinds, k.id] })} data-testid={`dgm-kind-${k.id}`} /> {k.label}</label>
              ))}
            </fieldset>
          )}
          {columnModes && (
            <label className="dgm-field">カラムの表示
              <select value={view.columnMode} onChange={(e) => update({ columnMode: e.target.value as ColumnMode })} data-testid="dgm-column-mode">
                {(Object.keys(COLUMN_MODE_LABELS) as ColumnMode[]).map((m) => <option key={m} value={m}>{COLUMN_MODE_LABELS[m]}</option>)}
              </select>
            </label>
          )}
          {groups && groups.length > 0 && (
            <fieldset className="dgm-fieldset"><legend>グループ (畳むと、中の画面と線を隠します)</legend>
              {groups.map((g) => (
                <label key={g.id} className="dgm-check"><input type="checkbox" checked={view.collapsedGroups.includes(g.id)} onChange={(e) => update({ collapsedGroups: e.target.checked ? [...view.collapsedGroups, g.id] : view.collapsedGroups.filter((x) => x !== g.id) })} data-testid={`dgm-collapse-${g.id}`} /> {g.label} を畳む</label>
              ))}
            </fieldset>
          )}
          <fieldset className="dgm-fieldset"><legend>この範囲だけ表示</legend>
            {view.scope ? (
              <div className="dgm-pop-row">選んだ {view.scope.ids.length} 件から {view.scope.depth} 段までを表示中
                <button type="button" className="dgm-small" onClick={() => update({ scope: null })} data-testid="dgm-scope-clear">全体を表示に戻す</button></div>
            ) : (
              <div className="dgm-pop-row">
                {[1, 2, 3].map((d) => (
                  <button key={d} type="button" className="dgm-small" disabled={selected.length === 0} onClick={() => { update({ scope: { ids: selected.map((n) => n.id), depth: d } }); setTimeout(() => fitView({ padding: 0.3, maxZoom: 1, duration: 200 }), 60); }} data-testid={`dgm-scope-${d}`}>選んだものから {d} 段</button>
                ))}
                {selected.length === 0 && <span className="dgm-muted">先にノードを選んでください</span>}
              </div>
            )}
          </fieldset>
          {hiddenLine && <div className="dgm-pop-row dgm-muted" data-testid="dgm-hidden-note">隠しているもの: ノード {decorated.hiddenNodeCount} 件・線 {decorated.hiddenEdgeCount} 本</div>}
        </div>
      )}

      {menu === "legend" && (
        <div className="dgm-pop" role="group" aria-label="凡例" data-testid="dgm-legend-pop">
          <ul className="dgm-legend">
            {legend.map((l, i) => (
              <li key={i}>
                {l.kind === "icon" ? <i className={`bi ${l.icon ?? "bi-dot"} dgm-legend-icon ${l.className ?? ""}`} />
                  : <span className={`dgm-legend-swatch dgm-legend-${l.kind} ${l.className ?? ""}`} aria-hidden="true" />}
                <span>{l.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {menu === "export" && (
        <div className="dgm-pop" role="group" aria-label="書き出し・印刷・基準との差分">
          <div className="dgm-pop-title">書き出し</div>
          <button type="button" className="dgm-item" onClick={() => void exportPng()} disabled={busy} data-testid="dgm-export-png"><i className="bi bi-file-earmark-image" /> 画像 (PNG) で保存 (図の全体)</button>
          {textKind && (
            <>
              <button type="button" className="dgm-item" onClick={() => void copyText("mermaid", false)} disabled={busy} data-testid="dgm-copy-mermaid"><i className="bi bi-clipboard" /> Mermaid の図をコピー</button>
              <button type="button" className="dgm-item" onClick={() => void copyText("plantuml", false)} disabled={busy} data-testid="dgm-copy-plantuml"><i className="bi bi-clipboard" /> PlantUML の図をコピー</button>
              <button type="button" className="dgm-item" onClick={() => void copyText("mermaid", true)} disabled={busy || selected.length === 0} data-testid="dgm-copy-selected"><i className="bi bi-clipboard-check" /> 選んだ {selected.length} 件だけ Mermaid でコピー</button>
            </>
          )}
          <div className="dgm-pop-title">印刷</div>
          <div className="dgm-pop-row">
            <select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)} aria-label="用紙" data-testid="dgm-paper">{PAPER_SIZES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)} aria-label="向き" data-testid="dgm-orientation"><option value="landscape">横</option><option value="portrait">縦</option></select>
            <button type="button" className="dgm-small" onClick={() => void printIt()} disabled={busy} data-testid="dgm-print"><i className="bi bi-printer" /> 印刷</button>
          </div>
          <div className="dgm-pop-row dgm-muted">図の全体を、1 ページに収めて印刷します (ページ分割はしません)。</div>
          <div className="dgm-pop-title">基準との差分</div>
          {api.baseline ? (
            <>
              <div className="dgm-pop-row dgm-muted">基準: {new Date(api.baseline.at).toLocaleString("ja-JP")}</div>
              <label className="dgm-check"><input type="checkbox" checked={view.diff} onChange={(e) => update({ diff: e.target.checked })} data-testid="dgm-diff" /> 基準からの追加・変更を色で見る</label>
              {view.diff && decorated.diff && (
                <div className="dgm-pop-row" data-testid="dgm-diff-summary">
                  追加 {[...decorated.diff.kinds.values()].filter((k) => k === "added").length} 件 ・ 変更 {[...decorated.diff.kinds.values()].filter((k) => k === "changed").length} 件 ・ 削除 {decorated.diff.removed.length} 件
                  {decorated.diff.removed.length > 0 && <div className="dgm-muted">削除: {decorated.diff.removed.slice(0, 6).map((r) => r.label).join("、")}{decorated.diff.removed.length > 6 ? " ほか" : ""}</div>}
                </div>
              )}
              <div className="dgm-pop-row">
                <button type="button" className="dgm-small" onClick={api.recordBaseline} data-testid="dgm-baseline-record">いまを基準にし直す</button>
                <button type="button" className="dgm-small" onClick={api.clearBaseline} data-testid="dgm-baseline-clear">基準をやめる</button>
              </div>
            </>
          ) : (
            <>
              <div className="dgm-pop-row dgm-muted">いまの状態を覚えておき、あとで増えた・変わった・消えたものを見られます (このブラウザにだけ覚えます)。</div>
              <button type="button" className="dgm-item" onClick={api.recordBaseline} data-testid="dgm-baseline-record"><i className="bi bi-bookmark-plus" /> いまの状態を基準にする</button>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
