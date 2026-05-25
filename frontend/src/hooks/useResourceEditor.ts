import { useCallback, useEffect, useRef, useState } from "react";
import { useUndoableState } from "./useUndoableState";
import { useUndoKeyboard } from "./useUndoKeyboard";
import { saveDraft, loadDraft, clearDraft, hasDraft } from "../utils/draftStorage";
import { acknowledgeServerMtime, hasServerBeenUpdated, type MtimeKind } from "../utils/serverMtime";
import { setDirty as setTabDirty, makeTabId, type TabType } from "../store/tabStore";
import { mcpBridge } from "../mcp/mcpBridge";
import type { DraftResourceType } from "../types/draft";
import { isRenameInProgressByTabType } from "../utils/renameInProgress";

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
  /**
   * #880 Phase 3: viewer mode で broadcast を受信して state を更新する。
   * "viewer" を指定すると read-only で editor の中間状態を追従する。
   * resourceType は draft-update / editSession.update フィルタに使用 (id と組み合わせて絞り込む)。
   *
   * #891 fix: EditMode の kind 文字列を直接受け入れるよう拡張。
   * "viewer" のみ broadcast 受信が有効、それ以外は early-return するため副作用なし。
   */
  viewerMode?: "viewer" | "editing" | "readonly";
  /** viewer mode の draft-update / editSession.update フィルタ用 resourceType */
  viewerResourceType?: DraftResourceType;
  /**
   * #900 Phase 3: editSession.update broadcast を受信する場合の EditSession ID。
   * この値が指定されている場合、editSession.update broadcast で editSessionId フィルタを行う。
   * 指定されない場合は旧 draft-update (resourceType/resourceId) でフィルタする。
   */
  viewerEditSessionId?: string;
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
  /**
   * P1-B fix (#908): conflict check 後の後処理のみ実行（ファイル書き込みなし）。
   * editSession.save がファイル書き込みを担う場合に使う。
   * markClean() + acknowledgeServerMtime() + setServerChanged(false) + setIsSaving 管理を行う。
   * 呼び出し側は事前に editSession.update (debounce flush) と actions.save() (conflict check) を完了させること。
   */
  postSave: () => Promise<void>;
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
    viewerMode,
    viewerResourceType,
    viewerEditSessionId,
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
      // I-7 Round 2 F-3 (#1299 Codex review M-4 / Opus review M-2):
      // rename / undo 完了直後の短窓 (3000ms) は、broadcast 受信→reload→load=null の
      // sequence で onNotFound を呼んで /<entityType>/list に redirect する race が
      // 発生する。handleRenameSuccess が markRenameInProgress で oldId/newId を
      // 登録しているため、現在の url id が in-flight 中なら redirect を skip する。
      // navigate は handleRenameSuccess 側で replace=true 実行済のため、ここで silent
      // skip しても新 url への遷移は別途確定する。
      if (isRenameInProgressByTabType(tabType, id)) {
        return;
      }
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

  /**
   * P1-B fix (#908): ファイル書き込みなしで後処理のみ実行。
   * editSession.save (conflict check + backend 書き込み) の後に呼ぶ。
   * - markClean(): draft クリア + isDirty → false + tabDirty → false
   * - acknowledgeServerMtime(): mtime を記録
   * - setServerChanged(false): サーバ変更バナーを閉じる
   * - isSaving の管理: setIsSaving(true/false) でラップ
   */
  const postSave = useCallback(async () => {
    if (!id) return;
    setIsSaving(true);
    try {
      markClean();
      await acknowledgeServerMtime(mtimeKind, id);
      setServerChanged(false);
    } finally {
      setIsSaving(false);
    }
  }, [id, markClean, mtimeKind]);

  const handleReset = useCallback(async () => {
    if (!id) return;
    clearDraft(draftKind, id);
    const loaded = await load(id);
    if (!loaded) {
      // I-7 Round 2 F-3 (#1299 Codex review M-4 / Opus review M-2): rename in-flight 中は
      // redirect skip (reload と同パターン)
      if (isRenameInProgressByTabType(tabType, id)) {
        return;
      }
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
  //
  // Phase G S-1 (Codex round 2 / Opus 独立レビュー confirm): rename / undo の broadcast は
  // 参照側 entity 種別の reload event を `{ reload: true }` payload で発火するが、id field を
  // 持たないため従来の `d[broadcastIdField] !== id` filter で reject されていた。これにより
  // 別 tab で開いている参照側 editor (例: cart-add ProcessFlow が Table store-master を参照、
  // 両方 open) は backend で disk 更新後も stale cache を保持 → dirty 状態で保存すると rename
  // の ref 更新が overwrite されて silent data corruption する。
  //
  // 対策: `reload: true` を「全件 invalidation シグナル」として id filter より先に処理する。
  // dirty なら serverChanged バナー、clean なら自動 reload (通常 event と同じ分岐)。
  useEffect(() => {
    if (!id) return;
    return mcpBridge.onBroadcast(broadcastName, (data) => {
      const d = data as Record<string, unknown>;
      // Phase G S-1: rename/undo 由来の全件 invalidation signal を id filter より先に処理
      if (d.reload === true) {
        if (isDirtyRef.current || !autoReloadOnClean) {
          setServerChanged(true);
        } else {
          reload().catch(console.error);
        }
        return;
      }
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

  // #880 Phase 3 / #900 Phase 3: viewer mode — broadcast を受信して state を更新する (sequence reorder 破棄)
  // lastSeq は effect の再実行 (viewer attach) ごとに 0 リセットする。
  // これは viewer attach 時にサーバから最新 snapshot を再受信する想定のため、
  // 旧 sequence との連続性を保つ必要がなく、常に最初の update から受け入れる。
  useEffect(() => {
    if (viewerMode !== "viewer" || !id) return;
    let lastSeq = 0;

    // 新 API: editSession.update broadcast (viewerEditSessionId が指定されている場合)
    if (viewerEditSessionId) {
      return mcpBridge.onBroadcast("editSession.update", (data) => {
        const d = data as {
          editSessionId: string;
          sequence?: number;
          payload?: unknown;
          senderSessionId?: string;
        };
        if (d.editSessionId !== viewerEditSessionId) return;
        if (typeof d.sequence === "number" && d.sequence <= lastSeq) return; // reorder 破棄
        lastSeq = d.sequence ?? lastSeq;
        // read-only render: payload を完全置換 (opaque envelope)
        resetState(d.payload as T);
      });
    }

    // 旧 API: draft-update broadcast (viewerResourceType が指定されている場合)
    if (!viewerResourceType) return;
    return mcpBridge.onBroadcast("draft-update", (data) => {
      const d = data as {
        resourceType?: string;
        resourceId?: string;
        sequence?: number;
        payload?: unknown;
        senderSessionId?: string;
      };
      if (d.resourceType !== viewerResourceType || d.resourceId !== id) return;
      if (typeof d.sequence === "number" && d.sequence <= lastSeq) return; // reorder 破棄
      lastSeq = d.sequence ?? lastSeq;
      // read-only render: payload を完全置換
      resetState(d.payload as T);
    });
  }, [viewerMode, viewerResourceType, viewerEditSessionId, id, resetState]);

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
    postSave,
    handleReset,
    dismissServerBanner,
    reload,
  };
}
