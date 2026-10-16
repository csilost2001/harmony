/**
 * 一覧で複数の設計を選んだときの、まとめての操作 (UI 改善提案 続編 第 6 弾 #110)。
 * - お気に入りに追加 / 外す (選んだものがすべてお気に入りなら「外す」)
 * - AI への指示・質問などのマーカーを、選んだ設計すべてに付ける
 * 設計の中身 (成熟度など) は、ここでは変えない (編集画面で、ロックと保存を通して変える)。
 */
import { useState } from "react";
import { newMarkerId, type MarkerEntityType } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { equivalentKeys, setFavorite, useFavorites } from "../../utils/favorites";
import { reportFailure } from "../../utils/failureToast";
import { showToast } from "../../utils/toast";
import { isImeComposing, isPlainEnter } from "../../utils/imeKeys";
import { MARKER_KIND_LABELS } from "../../utils/markerKinds";
import type { Marker, MarkerKind } from "../../types/v3";
import "../../styles/selectionActionBar.css";

export interface BulkConfig<T> {
  /** お気に入りの key (例: table:orders)。null の行は対象外 */
  favoriteKey?: (item: T) => string | null;
  /** マーカーを付けられる設計の種類と ID。null の行は対象外 */
  marker?: (item: T) => { entityType: MarkerEntityType; entityId: string } | null;
}

const KINDS: MarkerKind[] = ["chat", "question", "todo", "attention"];

export function SelectionActionBar<T>({ items, bulk, onClear }: { items: T[]; bulk: BulkConfig<T>; onClear: () => void }) {
  const { wsId } = useWorkspacePath();
  const [marking, setMarking] = useState(false);
  const [kind, setKind] = useState<MarkerKind>("chat");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const favorites = useFavorites(wsId); // お気に入りが変わったら、ボタンの文言も変わる

  const favKeys = bulk.favoriteKey ? items.map(bulk.favoriteKey).filter((k): k is string => !!k) : [];
  const allFav = favKeys.length > 0 && favKeys.every((k) => equivalentKeys(k).some((e) => favorites.includes(e)));
  const targets = bulk.marker ? items.map(bulk.marker).filter((t): t is NonNullable<ReturnType<NonNullable<BulkConfig<T>["marker"]>>> => !!t) : [];

  const toggleFav = () => {
    for (const k of favKeys) setFavorite(wsId, k, !allFav);
    showToast(allFav ? `${favKeys.length} 件をお気に入りから外しました` : `${favKeys.length} 件をお気に入りに追加しました`);
  };

  const addMarkers = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    // 1 件ずつ送る (選んだ件数ぶん。多くても一覧の件数まで)。失敗した設計は、名前を出して知らせる
    for (const t of targets) {
      const marker: Marker = { id: newMarkerId() as Marker["id"], kind, body: text, author: "human", createdAt: new Date().toISOString() as Marker["createdAt"] };
      try {
        await mcpBridge.request("applyMarkerChanges", { entityType: t.entityType, entityId: t.entityId, changes: { added: [marker], updated: [], removedIds: [] } });
        ok++;
      } catch (e) { failed.push(t.entityId); if (failed.length === 1) reportFailure(e, "マーカーのまとめて追加"); }
    }
    setBusy(false);
    if (ok > 0) { showToast(`${ok} 件の設計にマーカーを付けました${failed.length ? ` (${failed.length} 件は失敗: ${failed.slice(0, 3).join("、")}${failed.length > 3 ? " ほか" : ""})` : ""}`); setBody(""); setMarking(false); }
  };

  if (favKeys.length === 0 && targets.length === 0) return null;
  return (
    <div className="selection-bar" role="region" aria-label="選んだ設計へのまとめての操作" data-testid="selection-bar">
      <span className="selection-bar-count">{items.length} 件を選択中</span>
      {favKeys.length > 0 && (
        <button type="button" className="selection-bar-btn" onClick={toggleFav} data-testid="selection-bar-fav">
          <i className={`bi ${allFav ? "bi-star-fill" : "bi-star"}`} /> {allFav ? "お気に入りから外す" : "お気に入りに追加"}
        </button>
      )}
      {targets.length > 0 && !marking && (
        <button type="button" className="selection-bar-btn" onClick={() => setMarking(true)} data-testid="selection-bar-marker">
          <i className="bi bi-megaphone" /> マーカーを付ける{targets.length < items.length ? ` (${targets.length} 件が対象)` : ""}
        </button>
      )}
      {marking && (
        <span className="selection-bar-marker-form">
          <select value={kind} onChange={(e) => setKind(e.target.value as MarkerKind)} aria-label="マーカーの種類">
            {KINDS.map((k) => <option key={k} value={k}>{MARKER_KIND_LABELS[k]}</option>)}
          </select>
          <input type="text" autoFocus value={body} placeholder="例: 命名規約に合わせて直して" aria-label="マーカーの内容" data-testid="selection-bar-marker-body"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (isPlainEnter(e)) { e.preventDefault(); void addMarkers(); }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMarking(false); }
            }} />
          <button type="button" className="selection-bar-btn is-primary" disabled={!body.trim() || busy} onClick={() => void addMarkers()} data-testid="selection-bar-marker-add">{busy ? "付けています…" : `${targets.length} 件に付ける`}</button>
          <button type="button" className="selection-bar-btn" onClick={() => setMarking(false)}>やめる</button>
        </span>
      )}
      <button type="button" className="selection-bar-btn selection-bar-clear" onClick={onClear} title="選択を解除 (Esc)"><i className="bi bi-x-lg" /> 選択を解除</button>
    </div>
  );
}
