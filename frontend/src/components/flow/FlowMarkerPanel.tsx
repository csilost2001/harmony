/**
 * FlowEditor 用 マーカーパネル (#1003)
 *
 * 画面フロー上の各 screen.authoring.markers を横断集約して表示・編集する。
 * ProcessFlow 側の MarkerPanel.tsx を参考に、screen-flow 用に新設。
 * - @ts-nocheck は使わない (型をしっかり付ける)
 * - validator kind は手動追加 UI に出さない (AI/runtime が生成するもの)
 * - 手動追加可能な kind: chat / attention / todo / question の 4 種
 */

import { useState, useCallback } from "react";
import type { Screen } from "../../types/v3/screen";
import type { Marker, MarkerKind } from "../../types/v3/common";
import type { ScreenNode } from "../../types/flow";
import { generateUUID } from "../../utils/uuid";

// ── 定数 ────────────────────────────────────────────────────────────────────

const ADDABLE_KINDS: MarkerKind[] = ["chat", "attention", "todo", "question"];

const KIND_LABELS: Record<MarkerKind, string> = {
  chat: "チャット",
  attention: "注目",
  todo: "TODO",
  question: "質問",
  validator: "バリデーター",
};

const KIND_ICONS: Record<MarkerKind, string> = {
  chat: "bi-chat-left-text",
  attention: "bi-eye",
  todo: "bi-check2-square",
  question: "bi-question-circle",
  validator: "bi-exclamation-triangle",
};

// ── 型 ──────────────────────────────────────────────────────────────────────

/** 集約済みマーカー: 所属 screen 情報付き */
export interface AggregatedMarker {
  marker: Marker;
  screenId: string;
  screenName: string;
  /** flowProject.screens に対象 screen が存在しない = orphan */
  isOrphan: boolean;
}

export interface Props {
  /** flowProject.screens の ScreenNode 一覧 (orphan 判定用) */
  screens: ScreenNode[];
  /** screenId → Screen entity (loadScreenEntity 済み) */
  screenEntities: Map<string, Screen>;
  /** マーカー追加 / 解決 / 削除後に呼ばれるコールバック (screen entity を save する責務は呼び出し側) */
  onMarkerChange: (screenId: string, updatedMarkers: Marker[]) => Promise<void>;
  /** パネルを閉じる */
  onClose: () => void;
}

// ── ヘルパー ─────────────────────────────────────────────────────────────────

function aggregateMarkers(
  screens: ScreenNode[],
  screenEntities: Map<string, Screen>,
): AggregatedMarker[] {
  const result: AggregatedMarker[] = [];
  const validScreenIds = new Set(screens.map((s) => s.id));

  // screenEntities に含まれる全 screen を走査 (orphan も含む)
  for (const [screenId, entity] of screenEntities) {
    const markers = entity.authoring?.markers ?? [];
    for (const marker of markers) {
      result.push({
        marker,
        screenId,
        screenName: entity.name ?? screenId,
        isOrphan: !validScreenIds.has(screenId as unknown as ScreenNode["id"]),
      });
    }
  }

  // 作成日時降順
  result.sort(
    (a, b) =>
      new Date(b.marker.createdAt).getTime() - new Date(a.marker.createdAt).getTime(),
  );
  return result;
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export function FlowMarkerPanel({
  screens,
  screenEntities,
  onMarkerChange,
  onClose,
}: Props) {
  const [newScreenId, setNewScreenId] = useState<string>(screens[0]?.id ?? "");
  const [newKind, setNewKind] = useState<MarkerKind>("chat");
  const [newBody, setNewBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const aggregated = aggregateMarkers(screens, screenEntities);
  const displayed = showResolved
    ? aggregated
    : aggregated.filter((a) => !a.marker.resolvedAt);
  const unresolvedCount = aggregated.filter((a) => !a.marker.resolvedAt).length;

  // ── helpers ────────────────────────────────────────────────────────────────

  const getMarkersForScreen = useCallback(
    (screenId: string): Marker[] => {
      const entity = screenEntities.get(screenId);
      return entity?.authoring?.markers ?? [];
    },
    [screenEntities],
  );

  // ── actions ────────────────────────────────────────────────────────────────

  const handleAdd = useCallback(async () => {
    const body = newBody.trim();
    if (!body || !newScreenId) return;
    const newMarker: Marker = {
      id: generateUUID() as Marker["id"],
      kind: newKind,
      body,
      author: "human",
      createdAt: new Date().toISOString() as Marker["createdAt"],
    };
    const current = getMarkersForScreen(newScreenId);
    await onMarkerChange(newScreenId, [...current, newMarker]);
    setNewBody("");
  }, [newBody, newScreenId, newKind, getMarkersForScreen, onMarkerChange]);

  const handleStartResolve = useCallback((id: string) => {
    setResolvingId(id);
    setResolveNote("");
  }, []);

  const handleCancelResolve = useCallback(() => {
    setResolvingId(null);
    setResolveNote("");
  }, []);

  const handleConfirmResolve = useCallback(
    async (screenId: string, id: string) => {
      const note = resolveNote.trim();
      const current = getMarkersForScreen(screenId);
      const updated = current.map((m) =>
        m.id === id
          ? {
              ...m,
              resolvedAt: new Date().toISOString() as Marker["resolvedAt"],
              resolution: note || "(人間が手動で解決)",
            }
          : m,
      );
      await onMarkerChange(screenId, updated);
      setResolvingId(null);
      setResolveNote("");
    },
    [resolveNote, getMarkersForScreen, onMarkerChange],
  );

  const handleUnresolve = useCallback(
    async (screenId: string, id: string) => {
      const current = getMarkersForScreen(screenId);
      const updated = current.map((m) =>
        m.id === id ? { ...m, resolvedAt: undefined, resolution: undefined } : m,
      );
      await onMarkerChange(screenId, updated);
    },
    [getMarkersForScreen, onMarkerChange],
  );

  const handleRemove = useCallback(
    async (screenId: string, id: string) => {
      const current = getMarkersForScreen(screenId);
      const updated = current.filter((m) => m.id !== id);
      await onMarkerChange(screenId, updated);
    },
    [getMarkersForScreen, onMarkerChange],
  );

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flow-marker-panel" data-testid="flow-marker-panel">
      <div className="flow-marker-panel-header">
        <span className="flow-marker-panel-title">
          <i className="bi bi-megaphone" />{" "}
          AI へのマーカー ({unresolvedCount} 未解決 / {aggregated.length} 総件数)
        </span>
        <button
          type="button"
          className="btn btn-sm btn-link flow-marker-panel-close"
          onClick={onClose}
          title="閉じる"
        >
          <i className="bi bi-x-lg" />
        </button>
      </div>

      <div className="flow-marker-panel-body">
        <div className="catalog-help" style={{ marginBottom: 8, fontSize: "0.8rem" }}>
          画面フロー上の各画面に AI (Claude Code) への指示・質問を紐付けます。
          <br />
          <code>/designer-work</code> で未解決マーカーをまとめて処理させる。
        </div>

        {/* 解決済み表示切替 */}
        <div className="d-flex align-items-center gap-2 mb-2">
          <label className="small d-flex align-items-center gap-1">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              data-testid="show-resolved-checkbox"
            />
            解決済みも表示
          </label>
        </div>

        {/* マーカー一覧 */}
        {displayed.length === 0 && (
          <div className="catalog-empty" data-testid="marker-empty">
            {aggregated.length === 0
              ? "まだマーカーがありません。"
              : "未解決のマーカーはありません。"}
          </div>
        )}

        {displayed.map(({ marker: m, screenId, screenName, isOrphan }) => {
          const resolved = !!m.resolvedAt;
          const isResolving = resolvingId === m.id;
          return (
            <div
              key={m.id}
              className={`catalog-row marker-row marker-kind-${m.kind}${resolved ? " resolved" : ""}`}
              data-testid={`marker-row-${m.id}`}
            >
              <div className="catalog-row-header">
                <span className="marker-kind-badge">
                  <i className={`bi ${KIND_ICONS[m.kind]}`} />{" "}
                  {KIND_LABELS[m.kind] ?? m.kind}
                </span>
                <span className="marker-screen-ref small text-muted" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {screenName}
                </span>
                <span className="marker-author small text-muted">
                  {m.author === "human" ? "人間" : "AI"}
                </span>
                {isOrphan && !resolved && (
                  <span
                    className="marker-orphan-badge small"
                    title="紐付く画面が削除されたため、マーカーは孤立しています"
                    data-testid="marker-orphan-badge"
                  >
                    <i className="bi bi-unlock" /> 該当画面なし
                  </span>
                )}
                {resolved ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-success ms-auto"
                    onClick={() => { void handleUnresolve(screenId, m.id); }}
                    title="未解決に戻す"
                  >
                    <i className="bi bi-check-circle-fill" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-link ms-auto marker-resolve-btn"
                    onClick={() => handleStartResolve(m.id)}
                    title="解決済みにする (メモ付き)"
                    disabled={isResolving}
                    data-testid={`resolve-btn-${m.id}`}
                  >
                    <i className="bi bi-check-circle" />
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-link text-danger"
                  onClick={() => { void handleRemove(screenId, m.id); }}
                  title="削除"
                >
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
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void handleConfirmResolve(screenId, m.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        handleCancelResolve();
                      }
                    }}
                    autoFocus
                    data-testid="resolve-note-textarea"
                  />
                  <div className="marker-resolve-form-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-success"
                      onClick={() => { void handleConfirmResolve(screenId, m.id); }}
                      title="解決済みとして閉じる (Ctrl+Enter)"
                      data-testid="resolve-confirm-btn"
                    >
                      <i className="bi bi-check-lg" /> 解決
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={handleCancelResolve}
                      title="キャンセル (Esc)"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              )}

              {resolved && m.resolution && (
                <div className="marker-resolution">
                  <strong>解決メモ:</strong> {m.resolution}
                </div>
              )}

              <div className="marker-timestamps small text-muted">
                {new Date(m.createdAt).toLocaleString("ja-JP")}
                {resolved && m.resolvedAt && (
                  <> — 解決: {new Date(m.resolvedAt).toLocaleString("ja-JP")}</>
                )}
              </div>
            </div>
          );
        })}

        {/* マーカー追加フォーム */}
        <div className="catalog-row catalog-row-add marker-add-row" style={{ marginTop: 8 }}>
          <div className="d-flex gap-2 mb-2 flex-wrap">
            <select
              className="form-select form-select-sm"
              value={newScreenId}
              onChange={(e) => setNewScreenId(e.target.value)}
              style={{ maxWidth: 160 }}
              data-testid="marker-screen-select"
            >
              {screens.length === 0 && (
                <option value="">（画面がありません）</option>
              )}
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className="form-select form-select-sm"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as MarkerKind)}
              style={{ maxWidth: 120 }}
              data-testid="marker-kind-select"
            >
              {ADDABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="d-flex gap-2">
            <input
              className="form-control form-control-sm"
              placeholder="AI への指示・質問を入力 (例: ヘッダーを統一して)"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleAdd();
                }
              }}
              data-testid="marker-body-input"
            />
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={() => { void handleAdd(); }}
              disabled={!newBody.trim() || !newScreenId}
              data-testid="marker-add-btn"
            >
              <i className="bi bi-plus-lg" /> 追加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
