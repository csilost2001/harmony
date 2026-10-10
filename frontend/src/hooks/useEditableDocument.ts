/**
 * useEditableDocument — 1 件の文書 (業務フロー・帳票など) を、編集セッション (編集開始・ロック・
 * サーバ側の下書き・引き継ぎ) つきで編集するための共通フック。
 *
 * useEditSession (セッション) + useResourceEditor (読み込み・元に戻す・他の保存の検知) +
 * 下書きの送信・保存・保存済み後の後処理・再開の確認 を 1 か所にまとめる。
 * 画面側は `<EditSessionChrome {...session.chrome} />` を置き、`apply` で文書を変更するだけでよい。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditSession } from "./useEditSession";
import { useResourceEditor } from "./useResourceEditor";
import { useSaveShortcut } from "./useSaveShortcut";
import { useSessionUrlSync } from "./useSessionUrlSync";
import { mcpBridge } from "../mcp/mcpBridge";
import { makeTabId, setDirty as setTabDirty, type TabType } from "../store/tabStore";
import type { MtimeKind } from "../utils/serverMtime";
import type { DraftResourceType } from "../types/draft";
import type { EditSessionChromeProps } from "../components/editing/EditSessionChrome";

export interface UseEditableDocumentOptions<T> {
  resourceType: DraftResourceType;
  tabType: TabType;
  mtimeKind: MtimeKind;
  /** ブラウザ内の下書きの種別 (ハイフンを含めない: 下書き一覧が最初のハイフンで種別と ID を分けるため) */
  draftKind: string;
  id: string | undefined;
  load: (id: string) => Promise<T | null>;
  /** 外部変更を知らせる broadcast 名とその中の ID の項目名 */
  broadcastName: string;
  broadcastIdField: string;
  /** 文書が見つからなくなったとき (削除された等) */
  onNotFound?: () => void;
  /** 一覧から「作成して編集」で来たとき、自動で編集を始める flag の名前 (`harmony-auto-edit:<name>:<id>`) */
  autoEditKey: string;
}

export function useEditableDocument<T extends object>(opts: UseEditableDocumentOptions<T>) {
  const { resourceType, tabType, id, autoEditKey } = opts;
  const sessionId = mcpBridge.getSessionId();
  const { syncSessionToUrl, initialEditSessionId } = useSessionUrlSync({ resourceType, resourceId: id ?? "" });
  const { editSession, mode, loading: sessionLoading, isDirtyForTab, actions, attach, takeOver, saveConflict, onSaveConflictOverwrite, onSaveConflictCancel } = useEditSession({
    resourceType, resourceId: id ?? "", sessionId, editSessionId: initialEditSessionId,
  });

  const editor = useResourceEditor<T>({
    tabType,
    mtimeKind: opts.mtimeKind,
    draftKind: opts.draftKind,
    id,
    load: opts.load,
    // 保存は編集セッション経由 (actions.save)。ここは使わない
    save: async () => undefined,
    broadcastName: opts.broadcastName,
    broadcastIdField: opts.broadcastIdField,
    onNotFound: opts.onNotFound,
    viewerMode: mode.kind as "viewer" | "editing" | "readonly",
    viewerResourceType: resourceType,
    viewerEditSessionId: editSession?.id,
  });
  const { state: doc, isDirty, isSaving, serverChanged, update, undo, redo, canUndo, canRedo, postSave, handleReset, dismissServerBanner, reload } = editor;

  const editable = mode.kind === "editing";
  const docRef = useRef<T | null>(null);
  useEffect(() => { docRef.current = doc ?? null; }, [doc]);

  // ── 変更: 元に戻せる変更 + サーバ側の下書きへ (少し間をおいて) 送る ──
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editSessionIdRef = useRef<string | undefined>(undefined);
  editSessionIdRef.current = editSession?.id;
  const syncDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      const sid = editSessionIdRef.current;
      if (sid && docRef.current) mcpBridge.request("editSession.update", { editSessionId: sid, payload: docRef.current }).catch(console.error);
    }, 300);
  }, []);

  /**
   * 文書を変更する。変更の関数は、複製した文書を直接書き換えるか、新しい文書を返す。結果が同じなら何もしない。
   * 変更の関数は**副作用のない純粋な関数**にすること (差分の判定のために最大 3 回呼ぶ。
   * 選択の変更・通知の表示などは、関数の外で行う)。
   */
  const apply = useCallback((fn: (draft: T) => T | void) => {
    const cur = docRef.current;
    if (!editable || !cur) return;
    const probe = fn(structuredClone(cur));
    // 返り値が無ければ probe は書き換え後の複製そのもの。比較のため同じ関数をもう一度複製に当てる
    const after = probe ?? (() => { const c = structuredClone(cur); fn(c); return c; })();
    if (JSON.stringify(after) === JSON.stringify(cur)) return;
    update((draft) => {
      const next = fn(draft);
      if (next && next !== draft) {
        for (const k of Object.keys(draft)) delete (draft as Record<string, unknown>)[k];
        Object.assign(draft, next);
      }
    });
    syncDraft();
  }, [editable, update, syncDraft]);

  // ── 保存 ──
  const save = useCallback(async () => {
    if (!editable || isSaving) return;
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    if (editSession?.id && docRef.current) {
      await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: docRef.current });
    }
    // 競合 (他のセッションが先に保存した) のときは、後処理せずダイアログに任せる
    setSaveError(null);
    const { conflicted, failed } = await actions.save();
    if (failed) { setSaveError("保存できませんでした。内容を確認して、もう一度保存してください (編集中の内容は残っています)"); return; }
    if (conflicted) return;
    await postSave();
  }, [editable, isSaving, editSession, actions, postSave]);
  useSaveShortcut(() => { save().catch(console.error); }, editable);

  // ── 破棄・再開・強制解除のダイアログ ──
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDiscard, setShowDiscard] = useState(false);
  const [showForceRelease, setShowForceRelease] = useState(false);
  const [showResume, setShowResume] = useState(false);

  // 他のセッションの自分が参加している下書きが残っていれば、再開か破棄かを尋ねる
  useEffect(() => {
    if (!id || sessionLoading || mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      // ワークスペースの準備前は失敗することがあるため、少し待って数回試す
      for (let attempt = 0; attempt < 25 && !cancelled; attempt++) {
        try {
          const res = await mcpBridge.request("editSession.list", { resourceType, resourceId: id }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
          if (cancelled) return;
          const mine = mcpBridge.getSessionId();
          if ((res?.sessions ?? []).some((s) => s.state === "Active" && !!s.participants?.[mine])) setShowResume(true);
          return;
        } catch (err) {
          if (cancelled) return;
          const msg = String((err as Error)?.message ?? err);
          if (!msg.includes("WorkspaceUnset") && !msg.includes("workspace not")) { console.error(err); return; }
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id, resourceType, sessionLoading, mode.kind]);

  // 一覧の「作成して編集」「複製して編集」から来たときは、自動で編集を始める
  const autoEditFired = useRef(false);
  useEffect(() => {
    if (autoEditFired.current || !id || mode.kind !== "readonly" || sessionLoading) return;
    const key = `harmony-auto-edit:${autoEditKey}:${id}`;
    try { if (sessionStorage.getItem(key) !== "1") return; sessionStorage.removeItem(key); } catch { return; }
    autoEditFired.current = true;
    void actions.startEditing();
  }, [id, mode.kind, sessionLoading, actions, autoEditKey]);

  // タブの「編集中」印 (編集セッションを持っている間、または未保存の変更があるあいだ)。
  // 画面の「未保存」表示と離脱の警告は、変更があるとき (isDirty) だけにする
  const tabDirty = isDirtyForTab || isDirty;
  useEffect(() => {
    if (!id) return;
    const tabId = makeTabId(tabType, id);
    setTabDirty(tabId, tabDirty);
    return () => setTabDirty(tabId, false);
  }, [id, tabType, tabDirty]);

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;
  const chrome: EditSessionChromeProps = useMemo(() => ({
    mode,
    saving: isSaving,
    serverChanged,
    saveError,
    onDismissSaveError: () => setSaveError(null),
    saveConflict,
    showDiscard, showForceRelease, showResume,
    lockedByOther: lockedByOther ? { ownerSessionId: lockedByOther.ownerSessionId } : null,
    onStartEditing: actions.startEditing,
    onSave: () => { save().catch(console.error); },
    onDiscardClick: () => setShowDiscard(true),
    onForceReleaseClick: () => setShowForceRelease(true),
    onReloadServer: handleReset,
    onDismissServerBanner: dismissServerBanner,
    onForcedOutChoice: (c) => actions.handleForcedOut(c),
    onAfterForceUnlockChoice: (c) => actions.handleAfterForceUnlock(c),
    onResume: async () => { setShowResume(false); await actions.startEditing(); },
    onResumeDiscard: async () => { setShowResume(false); await actions.discard(); await handleReset(); },
    onResumeCancel: () => setShowResume(false),
    onDiscardConfirm: async () => { setShowDiscard(false); await actions.discard(); await handleReset(); },
    onDiscardCancel: () => setShowDiscard(false),
    onForceReleaseConfirm: async () => { setShowForceRelease(false); await actions.forceReleaseOther(); },
    onForceReleaseCancel: () => setShowForceRelease(false),
    onSaveConflictOverwrite: async () => { try { await onSaveConflictOverwrite(); await postSave(); } catch (e) { console.error("[useEditableDocument] 上書き保存に失敗:", e); } },
    onSaveConflictCancel,
  }), [mode, isSaving, serverChanged, saveError, saveConflict, showDiscard, showForceRelease, showResume, lockedByOther, actions, save, handleReset, dismissServerBanner, postSave, onSaveConflictOverwrite, onSaveConflictCancel]);

  return {
    doc, editable, mode, sessionLoading, dirty: isDirty, isSaving,
    apply, undo, redo, canUndo, canRedo, save, reload, discardLocal: handleReset,
    editSession, attach, takeOver, syncSessionToUrl, sessionId,
    chrome,
  };
}
