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
import { participantLabel } from "../../utils/participantLabel";
import { useEffect, useRef, useState, useCallback } from "react";
import { EDIT_SESSION_DISCARDED_RETENTION_DAYS } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";
import type { DraftResourceType } from "../../types/draft";
import type { EditMode } from "../../hooks/useEditSession";
import type { EditSessionData, ParticipantInfo } from "../../hooks/useEditSession";
import { DraftHistoryModal } from "./DraftHistoryModal";
import { requestApplyVersionWhenReady } from "../../utils/applyVersionBus";
import { showToast } from "../../utils/toast";
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
  return participantLabel(p.displayLabel, p.sessionId);
}

// ── 集約バッジ ────────────────────────────────────────────────────────────────

function AggregateBadge({ mode, othersEditing, othersDetail }: { mode: EditMode; othersEditing: number; othersDetail: string }) {
  if (mode.kind === "editing") {
    return <><span className="esd-badge-icon">✏️</span><span className="esd-badge-label">編集中</span></>;
  }
  if (mode.kind === "viewer") {
    return <><span className="esd-badge-icon">👁</span><span className="esd-badge-label">観察中</span></>;
  }
  return (
    <>
      <span className="esd-badge-icon">📄</span>
      <span className="esd-badge-label">正規版</span>
      {othersEditing > 0 && (
        <span className="esd-badge-others" data-testid="esd-others-editing" title={othersDetail}>他 {othersEditing} 件が編集中</span>
      )}
    </>
  );
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

  const editorLabel = editor ? participantDisplayLabel(editor) : null;
  // 「<編集者名> が編集中」。編集者名は別の要素に分けておく (文言で探せるように)
  const ownerName = isDiscarded || !editor ? null : amIEditor ? "あなた" : editorLabel;
  const titleRest = isDiscarded ? "破棄された編集セッション" : editor ? " が編集中" : "編集者のいない編集セッション";

  return (
    <div
      className={`esd-session-row ${isDiscarded ? "esd-session-discarded" : ""}`}
      data-testid={`esd-session-${session.id}`}
    >
      <div className="esd-session-main">
        <span className="esd-session-title">
          <i className={`bi ${isDiscarded ? "bi-trash3" : "bi-pencil-square"} esd-session-icon`} aria-hidden="true" />
          {editor && isAIParticipant(editor) && <span className="esd-ai-tag" title="AI">AI</span>}
          {ownerName && <span className="esd-row-owner-label" title={editor?.sessionId}>{ownerName}</span>}
          <span className="esd-session-title-rest">{titleRest}</span>
        </span>
        <span className="esd-session-meta">
          最終操作 {relativeTime(session.lastActivityAt)}
          {viewers.length > 0 && <> ・ 閲覧 {viewers.length} 人</>}
          <code className="esd-session-id" title={session.id}>{session.id.slice(0, 8)}</code>
        </span>
      </div>

      <div className="esd-actions">
        {/* 閲覧: View で参加する (自分が未参加で、有効なもの) */}
        {!isDiscarded && !myParticipant && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary esd-action-btn"
            onClick={() => onViewerAttach(session.id)}
            title="編集の内容を見る (閲覧のみ)"
            data-testid={`esd-viewer-btn-${session.id}`}
          >
            <i className="bi bi-eye" /> 閲覧
          </button>
        )}

        {/* 引き継ぐ: 閲覧中の自分が、編集権を引き継ぐ */}
        {!isDiscarded && amIViewer && editor && !amIEditor && (
          <button
            type="button"
            className="btn btn-sm btn-outline-warning esd-action-btn"
            onClick={() => onTakeOver(session.id)}
            title="編集権を引き継ぐ (いまの編集者は閲覧になります)"
            data-testid={`esd-takeover-btn-${session.id}`}
          >
            <i className="bi bi-arrow-left-right" /> 引き継ぐ
          </button>
        )}

        {/* 破棄: 自分が編集中のとき */}
        {!isDiscarded && amIEditor && (
          <button
            type="button"
            className="btn btn-sm btn-outline-danger esd-action-btn"
            onClick={() => onDiscard(session.id)}
            title="この編集セッションを破棄 (編集中の内容は捨てられます)"
            data-testid={`esd-discard-btn-${session.id}`}
          >
            <i className="bi bi-trash3" /> 破棄
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
  // 失敗しても直前の一覧は消さない (バッジの「他 N 件」が一瞬で消えないように)。
  // ワークスペースの準備前などで失敗しうるので、少し間をおいて数回やり直す。
  const sessionIdsRef = useRef<Set<string>>(new Set());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSessions = useCallback(async (): Promise<void> => {
    const run = async (attempt: number): Promise<void> => {
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      setListLoading(true);
      try {
        const result = await mcpBridge.request("editSession.list", {
          resourceType,
          resourceId,
        }) as { sessions: EditSessionData[] };
        const list = result.sessions ?? [];
        sessionIdsRef.current = new Set(list.map((x) => x.id));
        setSessions(list);
      } catch (e) {
        console.warn("[EditSessionDropdown] editSession.list failed:", e);
        if (attempt < 4) {
          retryTimerRef.current = setTimeout(() => { void run(attempt + 1); }, 1000 * (attempt + 1));
        }
      } finally {
        setListLoading(false);
      }
    };
    await run(0);
  }, [resourceType, resourceId]);

  // ── 表示中 (閉じていても) と展開時に editSession.list を取得 ─────────────────
  // 閉じた状態のバッジに「他の人が編集中」を出すため、開く前にも取得しておく。
  useEffect(() => {
    void fetchSessions();
    return () => {
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };
  }, [open, fetchSessions]);

  // ── 接続が (再) 確立したら取り直す ──────────────────────────────────────────
  useEffect(() => {
    let prev: string | null = null;
    return mcpBridge.onStatusChange((status) => {
      if (prev !== null && prev !== "connected" && status === "connected") void fetchSessions();
      prev = status;
    });
  }, [fetchSessions]);

  // ── broadcast 受信時に list を更新 ──────────────────────────────────────────
  // 同時に開いている他の編集画面の編集セッションについては取り直さない
  // (created は editSession、それ以外は editSessionId を持つ。一覧に無い ID は対象外)。
  useEffect(() => {
    const refresh = (data: unknown) => {
      const d = (data ?? {}) as { editSession?: EditSessionData; editSessionId?: string };
      if (d.editSession && (d.editSession.resourceType !== resourceType || d.editSession.resourceId !== resourceId)) return;
      if (!d.editSession && d.editSessionId && !sessionIdsRef.current.has(d.editSessionId)) return;
      void fetchSessions();
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
  }, [fetchSessions, resourceType, resourceId]);

  // 他の人 (または AI) が編集中の編集セッション数。閉じたバッジに出す
  const othersEditingCount = sessions.filter((s) => {
    if (s.state === "Discarded") return false;
    const editor = Object.values(s.participants).find((p) => p.role === "Edit");
    return !!editor && editor.sessionId !== currentSessionId;
  }).length;

  // 誰が・いつから・どこまで: バッジに触れると見える (UI 改善提案 第 5 弾 #91)。開くと、閲覧・引き継ぎができる
  const othersDetail = othersEditingCount === 0 ? "" : sessions
    .filter((s) => s.state !== "Discarded")
    .map((s) => {
      const editor = Object.values(s.participants).find((p) => p.role === "Edit");
      if (!editor || editor.sessionId === currentSessionId) return null;
      try { return `${participantDisplayLabel(editor)} が編集中 (最終操作 ${relativeTime(s.lastActivityAt)})`; } catch { return null; } // 説明は補足。作れなければ、出さない
    })
    .filter((x): x is string => !!x)
    .join("\n");

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
      const editor = Object.values(session?.participants ?? {}).find((p) => p.role === "Edit");
      const confirmed = window.confirm(
        `${editor ? participantLabel(editor.displayLabel, editor.sessionId) : "現在の編集者"} の編集権を引き継ぎます。\n` +
        `編集中の内容はそのまま引き継がれ、いまの編集者は閲覧になります。よろしいですか?`,
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
        `この編集セッションを破棄しますか? ${EDIT_SESSION_DISCARDED_RETENTION_DAYS} 日間は復元可能です。`,
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

  // ── 保存前の版を、編集画面へ読み込む ─────────────────────────────────────────
  // 編集中でなければ、先に編集を始めてから読み込む (読み込んだ内容は未保存の変更になる)
  const pendingVersion = useRef<{ snapshot: unknown } | null>(null);
  const dispatchVersion = useCallback((snapshot: unknown) => {
    // 編集画面が受け取りを登録するのは、この画面の反映のあと。受け取れるまで頼み直す
    requestApplyVersionWhenReady({ resourceType, resourceId, snapshot }, () => {
      showToast("この画面には読み込めませんでした。編集を始めてから、もう一度試してください", "error");
    });
  }, [resourceType, resourceId]);
  const applyVersion = useCallback((snapshot: unknown) => {
    if (currentMode.kind === "editing") { dispatchVersion(snapshot); return; }
    pendingVersion.current = { snapshot };
    onStartEditing?.();
  }, [currentMode.kind, dispatchVersion, onStartEditing]);
  useEffect(() => {
    if (currentMode.kind === "editing" && pendingVersion.current) {
      const { snapshot } = pendingVersion.current;
      pendingVersion.current = null;
      dispatchVersion(snapshot);
    }
  }, [currentMode.kind, dispatchVersion]);

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
        <AggregateBadge mode={currentMode} othersEditing={othersEditingCount} othersDetail={othersDetail ? `${othersDetail}\nクリックで、閲覧・引き継ぎができます` : ""} />
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
          if (onHistoryRestore) { onHistoryRestore(editSessionId); return; }
          // 既定: 復元した編集セッションで、この画面を開き直す (画面は、開くときに URL の ?session= の編集セッションへ入る。
          // 編集者として入ると、そのセッションの内容が編集状態に入る)
          const url = new URL(window.location.href);
          url.searchParams.set("session", editSessionId);
          window.location.assign(url.toString());
        }}
        onApplyVersion={applyVersion}
      />
    </div>
  );
}
