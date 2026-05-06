import { useCallback, useEffect, useRef, useState } from "react";
import { useUndoableState } from "./useUndoableState";
import { useUndoKeyboard } from "./useUndoKeyboard";
import { saveDraft, loadDraft, clearDraft, hasDraft } from "../utils/draftStorage";
import { acknowledgeServerMtime, hasServerBeenUpdated, type MtimeKind } from "../utils/serverMtime";
import { setDirty as setTabDirty, makeTabId, type TabType } from "../store/tabStore";
import { mcpBridge } from "../mcp/mcpBridge";

export interface UseResourceEditorOptions<T> {
  /** tabStore で使うタブ種別 */
  tabType: TabType;
  /** serverMtime の kind */
  mtimeKind: MtimeKind;
  /** draftStorage の kind（通常は tabType と同じ、違う場合のみ指定） */
  draftKind: string;
  /** リソース ID（undefined の間はロード等を行わない） */
  id: string | undefined;
  /** リソースをバックエンドから読み込む */
  load: (id: string) => Promise<T | null>;
  /** リソースを保存する */
  save: (data: T) => Promise<void>;
  /** 外部変更を通知する broadcast 名（例: "tableChanged"）*/
  broadcastName: string;
  /** broadcast payload のうち、自分のリソースか判定するフィールド名（デフォルト "id"）*/
  broadcastIdField?: string;
  /** load が null を返した時のハンドラ（例: リスト画面へリダイレクト）*/
  onNotFound?: () => void;
  /** ロード成功時のフック（副次データの fetch 等、初回・リセット両方で呼ばれる）*/
  onLoaded?: (data: T) => void;
  /** Ctrl+Z / Ctrl+Y のキーバインドを登録するか（デフォルト true）*/
  enableUndoKeyboard?: boolean;
  /** broadcast 受信時に dirty でなければ自動リロードするか（デフォルト true）*/
  autoReloadOnClean?: boolean;
}

export interface UseResourceEditorResult<T> {
  state: T | null;
  isDirty: boolean;
  isSaving: boolean;
  serverChanged: boolean;

  /** 構造変化（undo スタックに積む）。draft 保存 + isDirty 立てあり */
  update: (fn: (draft: T) => void) => void;
  /** テキスト編集中の一時更新（undo スタックに積まない）。draft 保存 + isDirty 立てあり */
  updateSilent: (fn: (draft: T) => void) => void;
  /** onBlur 時に呼ぶ: 現在の state を undo スタックに積む */
  commit: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  /** 保存実行（clean 化 + mtime ack）*/
  handleSave: () => Promise<void>;
  /** リセット実行（draft 破棄 + backend 再ロード + undo クリア）*/
  handleReset: () => Promise<void>;
  /** バナーのみ閉じる（state は変えない）*/
  dismissServerBanner: () => void;
  /** 再ロード（draft があれば優先、なければ backend）*/
  reload: () => Promise<void>;
}

/**
 * エディタ共通の保存・リセット・ロード・broadcast・dirty 追跡を集約するフック。
 *
 * 単一リソース（テーブル 1 件、処理フロー 1 件、画面 1 件）を編集する各エディタで
 * ほぼ同じパターンが 4 回コピペされていたロジックを 1 箇所に集約する。
 */
export function useResourceEditor<T>(opts: UseResourceEditorOptions<T>): UseResourceEditorResult<T> {
  const {
    tabType, mtimeKind, draftKind, id,
    load, save,
    broadcastName, broadcastIdField = "id",
    onNotFound, onLoaded,
    enableUndoKeyboard = true,
    autoReloadOnClean = true,
  } = opts;

  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [serverChanged, setServerChanged] = useState(false);
  const isDirtyRef = useRef(false);

  const onNotFoundRef = useRef(onNotFound);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onNotFoundRef.current = onNotFound;
    onLoadedRef.current = onLoaded;
  });

  const {
    state, update: updateRaw, updateAndCommit, commit,
    undo, redo, canUndo, canRedo, reset: resetState,
  } = useUndoableState<T | null>(null);

  useUndoKeyboard(undo, redo, enableUndoKeyboard);

  const markDirty = useCallback(() => {
    if (!id) return;
    setIsDirty(true);
    isDirtyRef.current = true;
    setTabDirty(makeTabId(tabType, id), true);
  }, [id, tabType]);

  const markClean = useCallback(() => {
    if (!id) return;
    clearDraft(draftKind, id);
    setIsDirty(false);
    isDirtyRef.current = false;
    setTabDirty(makeTabId(tabType, id), false);
  }, [id, draftKind, tabType]);

  const update = useCallback((fn: (draft: T) => void) => {
    if (!id) return;
    updateAndCommit((prev) => {
      if (prev == null) return prev;
      const next = structuredClone(prev);
      fn(next);
      saveDraft(draftKind, id, next);
      return next;
    });
    markDirty();
  }, [id, updateAndCommit, draftKind, markDirty]);

  const updateSilent = useCallback((fn: (draft: T) => void) => {
    if (!id) return;
    updateRaw((prev) => {
      if (prev == null) return prev;
      const next = structuredClone(prev);
      fn(next);
      saveDraft(draftKind, id, next);
      return next;
    });
    markDirty();
  }, [id, updateRaw, draftKind, markDirty]);

  const reload = useCallback(async (): Promise<void> => {
    if (!id) return;
    const loaded = await load(id);
    if (!loaded) {
      onNotFoundRef.current?.();
      return;
    }
    const draft = loadDraft<T>(draftKind, id);
    if (draft) {
      resetState(draft);
      setIsDirty(true);
      isDirtyRef.current = true;
      setTabDirty(makeTabId(tabType, id), true);
    } else {
      resetState(loaded);
      setIsDirty(false);
      isDirtyRef.current = false;
      setTabDirty(makeTabId(tabType, id), false);
      clearDraft(draftKind, id);
    }
    onLoadedRef.current?.(loaded);
  }, [id, load, draftKind, tabType, resetState]);

  const handleSave = useCallback(async () => {
    if (!state || !id) return;
    setIsSaving(true);
    try {
      await save(state);
      markClean();
      await acknowledgeServerMtime(mtimeKind, id);
      setServerChanged(false);
    } finally {
      setIsSaving(false);
    }
  }, [state, id, save, markClean, mtimeKind]);

  const handleReset = useCallback(async () => {
    if (!id) return;
    clearDraft(draftKind, id);
    const loaded = await load(id);
    if (!loaded) {
      onNotFoundRef.current?.();
      return;
    }
    resetState(loaded);
    setIsDirty(false);
    isDirtyRef.current = false;
    setTabDirty(makeTabId(tabType, id), false);
    setServerChanged(false);
    await acknowledgeServerMtime(mtimeKind, id);
    onLoadedRef.current?.(loaded);
  }, [id, draftKind, load, tabType, mtimeKind, resetState]);

  const dismissServerBanner = useCallback(() => {
    setServerChanged(false);
  }, []);

  // 初回ロード + mtime 初期化
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      await reload();
      if (cancelled) return;
      if (hasDraft(draftKind, id)) {
        if (await hasServerBeenUpdated(mtimeKind, id)) {
          if (!cancelled) setServerChanged(true);
        }
      } else {
        await acknowledgeServerMtime(mtimeKind, id);
      }
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [id, draftKind, mtimeKind, reload]);

  // 外部 broadcast 受信: dirty ならバナー、clean なら自動リロード
  useEffect(() => {
    if (!id) return;
    return mcpBridge.onBroadcast(broadcastName, (data) => {
      const d = data as Record<string, unknown>;
      if (d[broadcastIdField] !== id) return;
      if (isDirtyRef.current || !autoReloadOnClean) {
        setServerChanged(true);
      } else {
        reload().catch(console.error);
      }
    });
  }, [id, broadcastName, broadcastIdField, autoReloadOnClean, reload]);

  // MCP 接続復帰時の自動リロード（dirty でなければ）
  useEffect(() => {
    return mcpBridge.onStatusChange((s) => {
      if (s === "connected" && !isDirtyRef.current) reload().catch(console.error);
    });
  }, [reload]);

  return {
    state,
    isDirty,
    isSaving,
    serverChanged,
    update,
    updateSilent,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    handleSave,
    handleReset,
    dismissServerBanner,
    reload,
  };
}
