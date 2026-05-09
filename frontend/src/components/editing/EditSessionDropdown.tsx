/**
 * EditSessionDropdown.tsx (#900 Phase 3)
 *
 * エディタヘッダ用 EditSession 切替プルダウン UI。
 * spec docs/spec/edit-session-protocol.md §15.2 / §9.4 に準拠。
 *
 * 変更点 (Phase 3):
 * - データソース: usePresenceFor (旧) → editSession.list (新)
 * - AI 表示: displayLabel.includes("@AI") で "Alice@AI" 形式を表示
 * - アクション: 観察 [👁] (attachAsView) / 引継 [↪] (transferEdit) / 破棄 [×] (discard)
 * - 集約バッジ: EditMode (旧互換) から myRole (新 API) ベースに切替可
 *
 * 後方互換: currentMode (旧 EditMode) は引き続き受け付ける (Phase 6 で削除予定)
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import type { DraftResourceType } from "../../types/draft";
import type { EditMode } from "../../hooks/useEditSession";
import type { EditSessionData, ParticipantInfo } from "../../hooks/useEditSession";
import { DraftHistoryModal } from "./DraftHistoryModal";
import "../../styles/editSessionDropdown.css";

// ── 型 ──────────────────────────────────────────────────────────────────────

export interface EditSessionDropdownProps {
  resourceType: DraftResourceType;
  resourceId: string;
  currentMode: EditMode;
  currentSessionId: string;
  /** viewer として attach 後の callback (URL 更新等) */
  onViewerAttached?: (editSessionId: string) => void;
  /**
   * #980-A fix: viewer attach の本体 action — useEditSession.attach(editSessionId) を呼ぶ。
   * required: parent useEditSession に myRole を即時反映するため必須。
   * (旧 fallback `mcpBridge.request("editSession.attachAsView")` 直叩きは role 同期が崩れる
   * ため #980-A review 5 で削除済)
   */
  onAttachAsView: (editSessionId: string) => Promise<void>;
  /** 新規 draft 作成 (startEditing 相当) */
  onStartEditing?: () => void;
  /**
   * P2 fix (#908) → #980-A review 3: take-over callback — useEditSession.takeOver(editSessionId)
   * を呼ぶ。required: myRole 即時反映に必須 (fallback は #980-A で削除済)。
   */
  onTakeOver: (editSessionId: string) => Promise<void>;
  /**
   * #893: draft history から復元後の callback。
   * 新規作成された editSessionId を受け取り、エディタ側で URL 切替 + attach を行う。
   */
  onHistoryRestore?: (editSessionId: string) => void;
}

// ── 相対時間 ─────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 時間前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 日前`;
}

// ── AI participant 判定 ────────────────────────────────────────────────────────

/**
 * participant が AI かどうかを判定する。
 * spec §10.3: displayLabel が "Name@AI" 形式 or parentHumanSessionId が存在する。
 */
function isAIParticipant(p: ParticipantInfo): boolean {
  return !!p.parentHumanSessionId || p.displayLabel.endsWith("@AI");
}

/**
 * AI participant の表示ラベルを整形する。
 * spec §10.3: "Alice@AI" 形式。displayLabel がそのまま使える。
 */
function participantDisplayLabel(p: ParticipantInfo): string {
  return p.displayLabel || `@${p.sessionId.slice(0, 8)}`;
}

// ── 集約バッジ ────────────────────────────────────────────────────────────────

function AggregateBadge({ mode }: { mode: EditMode }) {
  if (mode.kind === "editing") {
    return <><span className="esd-badge-icon">✏️</span><span className="esd-badge-label">編集中</span></>;
  }
  if (mode.kind === "viewer") {
    return <><span className="esd-badge-icon">👁</span><span className="esd-badge-label">観察中</span></>;
  }
  return <><span className="esd-badge-icon">📄</span><span className="esd-badge-label">正規版</span></>;
}

// ── EditSession 行コンポーネント ──────────────────────────────────────────────

interface EditSessionRowProps {
  session: EditSessionData;
  currentSessionId: string;
  onViewerAttach: (editSessionId: string) => void;
  onTakeOver: (editSessionId: string) => Promise<void>;
  onDiscard: (editSessionId: string) => void;
}

function EditSessionRow({
  session,
  currentSessionId,
  onViewerAttach,
  onTakeOver,
  onDiscard,
}: EditSessionRowProps) {
  const allParticipants = Object.values(session.participants);
  const editor = allParticipants.find((p) => p.role === "Edit");
  const viewers = allParticipants.filter((p) => p.role === "View");

  const isDiscarded = session.state === "Discarded";
  const myParticipant = allParticipants.find((p) => p.sessionId === currentSessionId);
  const amIViewer = myParticipant?.role === "View";
  const amIEditor = myParticipant?.role === "Edit";

  return (
    <div
      className={`esd-session-row ${isDiscarded ? "esd-session-discarded" : ""}`}
      data-testid={`esd-session-${session.id}`}
    >
      {/* EditSession の状態アイコン + ID 短縮 */}
      <span className="esd-session-state-icon">
        {isDiscarded ? "🗑" : "📝"}
      </span>
      <span className="esd-session-id text-muted" title={session.id}>
        {session.id.slice(0, 12)}
      </span>

      {/* editor 表示 */}
      {editor && (
        <span className="esd-session-editor ms-1" title={editor.sessionId}>
          {isAIParticipant(editor) && <span className="esd-role-icon">🤖</span>}
          <span className="esd-row-owner-label">{participantDisplayLabel(editor)}</span>
          <span className="esd-role-icon ms-1" title="編集中">✏️</span>
        </span>
      )}

      {/* viewer 数 */}
      {viewers.length > 0 && (
        <span className="esd-viewer-count ms-1 text-muted">
          +{viewers.length} 👁
        </span>
      )}

      {/* 最終活動時刻 */}
      <span className="esd-row-time text-muted ms-1">
        {relativeTime(session.lastActivityAt)}
      </span>

      {/* アクションボタン群 */}
      <div className="esd-actions ms-auto">
        {/* [👁 観察]: View で attach — 自分が未参加、かつ Active */}
        {!isDiscarded && !myParticipant && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary esd-action-btn"
            onClick={() => onViewerAttach(session.id)}
            title="観察モードで閲覧"
            data-testid={`esd-viewer-btn-${session.id}`}
          >
            👁
          </button>
        )}

        {/* [↪ 引継]: View から Edit へ take-over — 自分が viewer、かつ editor がいる */}
        {!isDiscarded && amIViewer && editor && !amIEditor && (
          <button
            type="button"
            className="btn btn-sm btn-outline-warning esd-action-btn ms-1"
            onClick={() => onTakeOver(session.id)}
            title="編集権を引き継ぐ"
            data-testid={`esd-takeover-btn-${session.id}`}
          >
            ↪
          </button>
        )}

        {/* [× 破棄]: 自分が Edit role、かつ Active */}
        {!isDiscarded && amIEditor && (
          <button
            type="button"
            className="btn btn-sm btn-outline-danger esd-action-btn ms-1"
            onClick={() => onDiscard(session.id)}
            title="編集セッションを破棄"
            data-testid={`esd-discard-btn-${session.id}`}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// ── メインコンポーネント ───────────────────────────────────────────────────────

export function EditSessionDropdown({
  resourceType,
  resourceId,
  currentMode,
  currentSessionId,
  onViewerAttached,
  onAttachAsView,
  onStartEditing,
  onTakeOver,
  onHistoryRestore,
}: EditSessionDropdownProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<EditSessionData[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── editSession.list を取得 ──────────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    setListLoading(true);
    try {
      const result = await mcpBridge.request("editSession.list", {
        resourceType,
        resourceId,
      }) as { sessions: EditSessionData[] };
      setSessions(result.sessions ?? []);
    } catch (e) {
      console.warn("[EditSessionDropdown] editSession.list failed:", e);
      setSessions([]);
    } finally {
      setListLoading(false);
    }
  }, [resourceType, resourceId]);

  // ── 展開時に editSession.list を取得 ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    void fetchSessions();
  }, [open, fetchSessions]);

  // ── broadcast 受信時に list を更新 ──────────────────────────────────────────
  useEffect(() => {
    const refresh = () => {
      if (open) void fetchSessions();
    };
    const unsubs = [
      mcpBridge.onBroadcast("editSession.created", refresh),
      mcpBridge.onBroadcast("editSession.attached", refresh),
      mcpBridge.onBroadcast("editSession.detached", refresh),
      mcpBridge.onBroadcast("editSession.roleChanged", refresh),
      mcpBridge.onBroadcast("editSession.saved", refresh),
      mcpBridge.onBroadcast("editSession.discarded", refresh),
    ];
    return () => unsubs.forEach((u) => u());
  }, [open, fetchSessions]);

  // ── クリックアウトサイドで閉じる ───────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── [👁 観察] — viewer として attach ─────────────────────────────────────
  // #980-A: useEditSession.attach 経由で myRole / editSession state を即時反映する。
  // onAttachAsView は required prop (#980-A review 5)。fallback path は削除済 — 直接
  // mcpBridge を叩く経路は parent broadcast handler が editSession?.id null のため起動せず
  // myRole 同期が崩れるバグを引き起こすため、TS compile error で検出する。
  const handleViewerAttach = useCallback(
    async (editSessionId: string) => {
      try {
        await onAttachAsView(editSessionId);
        onViewerAttached?.(editSessionId);
        setOpen(false);
      } catch (e) {
        console.error("[EditSessionDropdown] attachAsView failed:", e);
      }
    },
    [onAttachAsView, onViewerAttached],
  );

  // ── [↪ 引継] — take-over ──────────────────────────────────────────────────
  const handleTakeOver = useCallback(
    async (editSessionId: string) => {
      const session = sessions.find((s) => s.id === editSessionId);
      const editorLabel = Object.values(session?.participants ?? {}).find((p) => p.role === "Edit")?.displayLabel;
      const confirmed = window.confirm(
        `${editorLabel ? `@${editorLabel}` : "現在の編集者"} さんの編集権を引き継ぎます。\n` +
        `現在の編集状態 (payload) はそのまま引き継がれます。よろしいですか?`,
      );
      if (!confirmed) return;
      try {
        // P2 fix (#908) → #980-A review 3: onTakeOver は required prop。useEditSession.takeOver
        // 経由で実行し、選択した session に対して take-over を実行する。myRole も即時更新される。
        // fallback path (mcpBridge 直叩き) は削除済 — myRole が broadcast 経由でしか更新されず
        // 遅延するため。
        await onTakeOver(editSessionId);
        setOpen(false);
      } catch (e) {
        console.error("[EditSessionDropdown] transferEdit/takeOver failed:", e);
      }
    },
    [sessions, onTakeOver],
  );

  // ── [× 破棄] — discard ────────────────────────────────────────────────────
  const handleDiscard = useCallback(
    async (editSessionId: string) => {
      const confirmed = window.confirm(
        "この編集セッションを破棄しますか? 30 日間は復元可能です。",
      );
      if (!confirmed) return;
      try {
        await mcpBridge.request("editSession.discard", { editSessionId });
        await fetchSessions();
      } catch (e) {
        console.error("[EditSessionDropdown] discard failed:", e);
      }
    },
    [fetchSessions],
  );

  // ── [+ 新規 draft を作成] ─────────────────────────────────────────────────
  const handleNewDraft = useCallback(async () => {
    if (onStartEditing) {
      onStartEditing();
    }
    setOpen(false);
  }, [onStartEditing]);

  return (
    <div className="esd-root" ref={dropdownRef} data-testid="edit-session-dropdown">
      {/* 集約バッジ (closed 状態) */}
      <button
        type="button"
        className="esd-toggle btn btn-sm btn-outline-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="esd-toggle-btn"
      >
        <AggregateBadge mode={currentMode} />
        <i className={`bi bi-chevron-${open ? "up" : "down"} ms-1 esd-chevron`} />
      </button>

      {/* 展開ドロップダウン */}
      {open && (
        <div className="esd-dropdown" role="listbox" data-testid="esd-dropdown">
          {/* 現在の正規版 */}
          <div className="esd-section-row esd-current-row" role="option">
            <span className="esd-status-dot esd-dot-active" />
            <span className="esd-row-icon">📄</span>
            <span className="esd-row-label">正規版</span>
            {currentMode.kind === "readonly" && (
              <span className="badge bg-secondary ms-auto esd-current-badge">現在</span>
            )}
          </div>

          {/* EditSession 一覧 */}
          {listLoading ? (
            <div className="esd-loading text-muted px-2 py-1">
              <span className="spinner-border spinner-border-sm me-1" role="status" />
              読み込み中...
            </div>
          ) : (
            <>
              {sessions.length > 0 && <hr className="esd-divider" />}
              {sessions.map((session) => (
                <EditSessionRow
                  key={session.id}
                  session={session}
                  currentSessionId={currentSessionId}
                  onViewerAttach={handleViewerAttach}
                  onTakeOver={handleTakeOver}
                  onDiscard={handleDiscard}
                />
              ))}
            </>
          )}

          <hr className="esd-divider" />

          {/* + 新規 draft を作成 */}
          <button
            type="button"
            className="esd-new-draft-btn btn btn-sm btn-link w-100 text-start"
            onClick={() => void handleNewDraft()}
            data-testid="esd-new-draft-btn"
          >
            <i className="bi bi-plus-circle me-1" />
            新規 draft を作成
          </button>

          {/* 履歴 (#893) */}
          <button
            type="button"
            className="esd-new-draft-btn btn btn-sm btn-link w-100 text-start"
            onClick={() => {
              setOpen(false);
              setHistoryModalOpen(true);
            }}
            data-testid="esd-history-btn"
          >
            <i className="bi bi-clock-history me-1" />
            履歴 (過去の draft)
          </button>
        </div>
      )}

      {/* DraftHistoryModal (#893) */}
      <DraftHistoryModal
        resourceType={resourceType}
        resourceId={resourceId}
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        onRestore={(editSessionId) => {
          setHistoryModalOpen(false);
          onHistoryRestore?.(editSessionId);
        }}
      />
    </div>
  );
}
