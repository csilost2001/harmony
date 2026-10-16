/**
 * マーカー (AI への指示・質問・メモ) のパネル。どの設計の編集画面でも同じ見た目・同じ操作で使う共通の部品。
 * 処理フローの MarkerPanel は、これに「工程の位置」の扱いを足した薄い包み。
 *
 * - 追加: 種類を選び、(位置を選べる設計では) 位置を選び、本文を書く。Enter で追加、Shift+Enter で改行、Ctrl+Enter でも追加
 *   (日本語の変換中の Enter は無視する)
 * - 解決 (メモつき)・未解決に戻す・削除
 * - 絞り込み: 解決済みも表示 / 種類 (凡例を兼ねる)
 * - 「AI に渡す文をコピー」: 未解決のマーカーを、AI (Claude Code など) にそのまま貼れる依頼の文にする
 * 保存の場所は、設計の `authoring.markers` (AI は MCP の designer__list_markers で同じ場所を読む)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { anchorLabel, buildAiPrompt, newMarkerId, type MarkerEntityType } from "@harmony/shared";
import type { Marker, MarkerKind } from "../../types/v3";
import { isImeComposing } from "../../utils/imeKeys";
import { showToast } from "../../utils/toast";
import { MARKER_KIND_ICONS, MARKER_KIND_LABELS } from "../../utils/markerKinds";
import "../../styles/markerPanel.css";

const ADDABLE: MarkerKind[] = ["chat", "attention", "todo", "question"];

export interface MarkerAnchorChoice {
  /** anchor.fieldPath に入れる値 (例: `$.columns[col-02]`) */
  value: string;
  label: string;
}

export interface MarkerListPanelProps {
  markers: readonly Marker[];
  /** 変更後のマーカー一覧 (空なら空の配列) */
  onChange: (next: Marker[]) => void;
  /** 「AI に渡す文」に出す、設計の種類・id・名前 */
  entity: { type: MarkerEntityType; id: string; name?: string };
  /** 位置を選べる設計 (テーブルのカラムなど) では、選択肢。無ければ (または空なら) 位置の選択を出さない */
  anchorChoices?: readonly MarkerAnchorChoice[];
  /** 新しく付けるマーカーの位置を、外から指定 (キー操作・行のボタンから)。設定されたら、位置の選択に反映する */
  presetAnchor?: string;
  readOnly?: boolean;
  /** 親から排他展開を制御する場合に指定 (undefined なら内部 state) */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /** トグルと本体を別の位置に描く場合 */
  render?: "full" | "toggleOnly" | "bodyOnly";
  /** 位置の表示 (既定: anchorLabel) */
  anchorText?: (m: Marker) => string | null;
  /** 位置が既に無い (削除された) マーカーの印 */
  isOrphan?: (m: Marker) => boolean;
  orphanTitle?: string;
  /** 「位置へ」: マーカーの位置を画面で示す */
  onJump?: (m: Marker) => void;
  /** 増えるたびに、パネルを開いて追加欄へフォーカスする (「マーカーを追加」のキー・コマンド用) */
  focusToken?: number;
  /** 説明文の追加 (処理フロー向けの committed の注意など) */
  help?: React.ReactNode;
  addPlaceholder?: string;
}

export function MarkerListPanel({
  markers, onChange, entity, anchorChoices, presetAnchor, readOnly = false, expanded: expandedProp, onExpandedChange, render = "full",
  anchorText, isOrphan, orphanTitle, onJump, focusToken, help, addPlaceholder,
}: MarkerListPanelProps) {
  // 既定で折りたたみ (#261): マーカー追加/解決時の縦方向レイアウト揺れを抑える
  const [expandedState, setExpandedState] = useState(false);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : expandedState;
  const setExpanded = (next: boolean) => {
    if (!isControlled) setExpandedState(next);
    onExpandedChange?.(next);
  };
  const [newKind, setNewKind] = useState<MarkerKind>("chat");
  const [newBody, setNewBody] = useState("");
  const [newAnchor, setNewAnchor] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [kindFilter, setKindFilter] = useState<MarkerKind | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const addRef = useRef<HTMLTextAreaElement>(null);
  // 追加欄は、書いた行数に合わせて、高さが伸びる (最大 8 行ぶん)
  useEffect(() => {
    const el = addRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 22)}px`;
  }, [newBody, expanded]);

  const unresolved = markers.filter((m) => !m.resolvedAt).length;
  const displayed = useMemo(
    () => markers.filter((m) => (showResolved || !m.resolvedAt) && (kindFilter === null || m.kind === kindFilter)),
    [markers, showResolved, kindFilter],
  );
  const kindsPresent = useMemo(() => ADDABLE.filter((k) => markers.some((m) => m.kind === k && (showResolved || !m.resolvedAt))), [markers, showResolved]);

  // 位置の指定 (キー操作・行のボタン) が変わったら、追加欄の位置の選択に反映する (描画の中で、状態を合わせる)
  const [seenPreset, setSeenPreset] = useState(presetAnchor);
  if (presetAnchor !== seenPreset) {
    setSeenPreset(presetAnchor);
    if (presetAnchor !== undefined) setNewAnchor(presetAnchor);
  }
  // 「マーカーを追加」の合図: 開いて、追加欄へ
  useEffect(() => {
    if (!focusToken) return;
    const t = setTimeout(() => {
      if (!expanded) setExpanded(true);
      setTimeout(() => addRef.current?.focus(), 30);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  const addMarker = () => {
    const body = newBody.trim();
    if (!body || readOnly) return;
    const next: Marker = {
      id: newMarkerId() as Marker["id"],
      kind: newKind,
      body,
      author: "human",
      createdAt: new Date().toISOString() as Marker["createdAt"],
      ...(newAnchor ? { anchor: { fieldPath: newAnchor } } : {}),
    };
    onChange([...markers, next]);
    setNewBody("");
  };
  const removeMarker = (id: string) => onChange(markers.filter((m) => m.id !== id));
  const startResolve = (id: string) => { setResolvingId(id); setResolveNote(""); };
  const cancelResolve = () => { setResolvingId(null); setResolveNote(""); };
  const confirmResolve = (id: string) => {
    const note = resolveNote.trim();
    onChange(markers.map((m) => (
      m.id === id ? { ...m, resolvedAt: new Date().toISOString() as Marker["resolvedAt"], resolution: note || "(人間が手動で解決)" } : m
    )));
    cancelResolve();
  };
  const unresolve = (id: string) => onChange(markers.map((m) => (m.id === id ? { ...m, resolvedAt: undefined, resolution: undefined } : m)));

  const copyForAi = async () => {
    const text = buildAiPrompt(markers.map((m) => ({ entityType: entity.type, entityId: entity.id, entityName: entity.name, marker: m })));
    if (!text) { showToast("AI に渡す未解決のマーカーがありません", "info"); return; }
    try {
      await navigator.clipboard.writeText(text);
      showToast(`AI に渡す文をコピーしました (未解決 ${unresolved} 件)。Claude Code などに貼り付けてください`, "success");
    } catch {
      showToast("コピーできませんでした (ブラウザの権限)", "error");
    }
  };

  const showToggle = render !== "bodyOnly";
  const showBody = render === "bodyOnly" || (render !== "toggleOnly" && expanded);
  const hasChoices = !!anchorChoices && anchorChoices.length > 0;
  const textOf = (m: Marker) => (anchorText ? anchorText(m) : (m.anchor ? anchorLabel(m.anchor) : null));

  return (
    <div className="catalog-panel marker-panel" data-region="マーカー" data-testid="marker-panel">
      {showToggle && (
        <button type="button" className="catalog-panel-toggle" onClick={() => setExpanded(!expanded)}>
          <i className={`bi bi-chevron-${expanded ? "down" : "right"}`} />
          <i className="bi bi-megaphone" />
          {" "}AI へのマーカー ({unresolved} 未解決 / {markers.length} 総件数)
        </button>
      )}
      {showBody && (
        <div className="catalog-panel-body">
          <div className="catalog-help">
            AI (Claude Code) への指示・質問を保持。
            <code>/designer-work</code> で未解決マーカーをまとめて処理させる。
            {help}
          </div>
          <div className="marker-toolbar">
            <label className="small d-flex align-items-center gap-1">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              解決済みも表示
            </label>
            {kindsPresent.length > 1 && kindsPresent.map((k) => (
              <button key={k} type="button" className="marker-filter-chip" aria-pressed={kindFilter === k}
                onClick={() => setKindFilter(kindFilter === k ? null : k)} title={`${MARKER_KIND_LABELS[k]}だけを表示 (もう一度押すと解除)`}>
                <i className={`bi ${MARKER_KIND_ICONS[k]}`} /> {MARKER_KIND_LABELS[k]}
              </button>
            ))}
            <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={() => { void copyForAi(); }} disabled={unresolved === 0}
              title="未解決のマーカーを、AI (Claude Code など) にそのまま貼り付けて頼める文にして、コピーします" data-testid="marker-copy-ai">
              <i className="bi bi-clipboard" /> AI に渡す文をコピー
            </button>
          </div>
          {displayed.length === 0 && (
            <div className="catalog-empty">
              {markers.length === 0 ? "まだマーカーがありません。" : "表示するマーカーがありません (絞り込みを外すと、ほかのものが見えます)。"}
            </div>
          )}
          {displayed.map((m) => {
            const resolved = !!m.resolvedAt;
            const isResolving = resolvingId === m.id;
            const where = textOf(m);
            return (
              <div className={`catalog-row marker-row marker-kind-${m.kind} ${resolved ? "resolved" : ""}`} key={m.id} data-marker-id={m.id}>
                <div className="catalog-row-header">
                  <span className="marker-kind-badge"><i className={`bi ${MARKER_KIND_ICONS[m.kind]}`} /> {MARKER_KIND_LABELS[m.kind]}</span>
                  <span className="marker-author small text-muted">{m.author === "human" ? "人間" : "AI"}</span>
                  {where && <span className="marker-step-ref marker-anchor-ref small text-muted">{where}</span>}
                  {onJump && m.anchor && (
                    <button type="button" className="btn btn-sm btn-link marker-jump-btn" onClick={() => onJump(m)} title="この位置を画面で示す">
                      <i className="bi bi-crosshair" /> 位置へ
                    </button>
                  )}
                  {isOrphan?.(m) && !resolved && (
                    <span className="marker-orphan-badge small" title={orphanTitle ?? "紐付く位置が削除されました"}>
                      <i className="bi bi-unlock" /> 該当なし
                    </span>
                  )}
                  {resolved ? (
                    <button type="button" className="btn btn-sm btn-link text-success ms-auto" onClick={() => unresolve(m.id)} title="未解決に戻す" disabled={readOnly}>
                      <i className="bi bi-check-circle-fill" />
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-link ms-auto marker-resolve-btn" onClick={() => startResolve(m.id)}
                      title="解決済みにする (メモ付き)" disabled={isResolving || readOnly}>
                      <i className="bi bi-check-circle" />
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => removeMarker(m.id)} title="削除" disabled={readOnly}>
                    <i className="bi bi-trash" />
                  </button>
                </div>
                <div className="marker-body">{m.body}</div>
                {isResolving && !resolved && (
                  <div className="marker-resolve-form">
                    <textarea
                      className="form-control form-control-sm"
                      rows={2}
                      value={resolveNote}
                      placeholder="解決メモ (任意): 何をしたか・なぜ閉じるか"
                      onChange={(e) => setResolveNote(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" && !isImeComposing(e)) && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirmResolve(m.id); }
                        else if (e.key === "Escape") { e.preventDefault(); cancelResolve(); }
                      }}
                      autoFocus
                    />
                    <div className="marker-resolve-form-actions">
                      <button type="button" className="btn btn-sm btn-success" onClick={() => confirmResolve(m.id)} title="解決済みとして閉じる (Ctrl+Enter)">
                        <i className="bi bi-check-lg" /> 解決
                      </button>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={cancelResolve} title="キャンセル (Esc)">キャンセル</button>
                    </div>
                  </div>
                )}
                {resolved && m.resolution && (
                  <div className="marker-resolution"><strong>解決メモ:</strong> {m.resolution}</div>
                )}
                <div className="marker-timestamps small text-muted">
                  {new Date(m.createdAt).toLocaleString("ja-JP")}
                  {resolved && m.resolvedAt && <> — 解決: {new Date(m.resolvedAt).toLocaleString("ja-JP")}</>}
                </div>
              </div>
            );
          })}
          {!readOnly && (
            <div className="catalog-row catalog-row-add marker-add-row">
              <select className="form-select form-select-sm" value={newKind} onChange={(e) => setNewKind(e.target.value as MarkerKind)} style={{ maxWidth: 120 }} aria-label="マーカーの種類">
                {ADDABLE.map((k) => <option key={k} value={k}>{MARKER_KIND_LABELS[k]}</option>)}
              </select>
              {hasChoices && (
                <select className="form-select form-select-sm" value={newAnchor} onChange={(e) => setNewAnchor(e.target.value)} style={{ maxWidth: 180 }} aria-label="マーカーの位置" data-testid="marker-anchor-select">
                  <option value="">全体</option>
                  {anchorChoices!.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              )}
              <textarea
                ref={addRef}
                className="form-control form-control-sm marker-add-input"
                rows={1}
                placeholder={addPlaceholder ?? "AI への指示・質問を入力 (Enter で追加、Shift+Enter で改行。例: 在庫引当の SQL を条件付き UPDATE に変更して)"}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isImeComposing(e) && !e.shiftKey) { e.preventDefault(); addMarker(); }
                }}
                data-testid="marker-add-input"
              />
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={addMarker} disabled={!newBody.trim()} data-testid="marker-add-btn">
                <i className="bi bi-plus-lg" /> 追加
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
