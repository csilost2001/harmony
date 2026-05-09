import { useState, useCallback, useEffect, useRef } from "react";
import { checkLegacyLocalStorage, executeRescue, clearLegacyLocalStorage } from "../grapes/legacyLocalStorageRescue";
import { acknowledgeServerMtime } from "../utils/serverMtime";
import { recordError } from "../utils/errorLog";
import { DesignSubToolbar, DesignSubToolbarGrapesJSBridge } from "./design/DesignSubToolbar";
import { ServerChangeBanner } from "./common/ServerChangeBanner";
import { useErrorDialog } from "./common/ErrorDialogProvider";
import { mcpBridge, type McpStatus } from "../mcp/mcpBridge";
import { loadProject, loadRawProject, updateScreenThumbnail } from "../store/flowStore";
import { loadScreenEntity } from "../store/screenStore";
import { makeTabId, setDirty } from "../store/tabStore";
import type { CssFramework } from "../types/v3/project";
import { resolveCssFramework } from "../utils/resolveCssFramework";
import { resolveEditorKind } from "../utils/resolveEditorKind";
import type { EditorKind } from "../utils/resolveEditorKind";
import { useEditSession } from "../hooks/useEditSession";
import { useSessionUrlSync } from "../hooks/useSessionUrlSync";
import { EditModeToolbar } from "./editing/EditModeToolbar";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "./editing/ConfirmDialogs";
import { SaveConflictDialog } from "./editing/SaveConflictDialog";
import { ResumeOrDiscardDialog } from "./editing/ResumeOrDiscardDialog";
import { PuckBackend } from "../editor/PuckBackend";
import { GrapesJSBackend } from "../editor/GrapesJSBackend";
import type { EditorApi, EditorState, GrapesJSRenderEditorProps, PuckRenderEditorProps } from "../editor/EditorBackend";
import "../styles/editMode.css";

const PANEL_MODE_KEY = "designer-panel-left-mode";
const THEME_KEY = "designer-theme";

export type PanelMode = "pinned" | "autohide" | "hidden";
export type ThemeId = "standard" | "card" | "compact" | "dark";

// GrapesJS 固有の constants (FRAMEWORK_URLS / VARIANT_URLS / applyThemeToCanvas /
// buildGjsOptions / safeComponentsLength / captureThumbnail) は #815 PR-B で
// frontend/src/editor/GrapesJSBackend.tsx に移動。Designer.tsx は EditorApi 経由で
// 同等機能を呼び出す (api.applyTheme / api.captureThumbnail / api.isCanvasEmpty 等)。

export interface DesignerProps {
  screenId: string;
  screenName?: string;
  onBack?: () => void;
  isActive?: boolean;
}

export function Designer({ screenId, screenName, onBack, isActive }: DesignerProps) {
  const [isDirty, setIsDirtyState] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [serverChanged, setServerChanged] = useState(false);
  const isDirtyRef = useRef(false);
  const [activeTheme, setActiveThemeState] = useState<ThemeId>(
    () => (localStorage.getItem(THEME_KEY) as ThemeId | null) ?? "standard"
  );
  // project.techStack.designer.cssFramework (#793 子 5 / #826): 省略時は "bootstrap" (schema default と一致)
  const [cssFramework, setCssFramework] = useState<CssFramework>("bootstrap");
  const cssFrameworkRef = useRef<CssFramework>("bootstrap");
  // editorKind (#806 子 3): 省略時は "grapesjs" (schema default と一致)
  const [editorKind, setEditorKind] = useState<EditorKind>("grapesjs");
  // Puck Backend (#815 PR-A: container 直マウントを廃止、React コンポーネントとして render)
  const puckBackendRef = useRef<PuckBackend | null>(null);
  const [puckState, setPuckState] = useState<EditorState | null>(null);
  // Puck 用 debounce フラッシュコールバック (#806 M-1: "puck-data" draft 経由で保存)
  const puckFlushRef = useRef<(() => void) | null>(null);
  // Puck onChange の pending payload + debounce timer (handleSave で flush するため ref で保持)
  const puckPendingPayloadRef = useRef<unknown>(null);
  const puckPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // GrapesJS Backend (#815 PR-B: <GjsEditor> 直接マウントを廃止、Backend.renderEditor 経由)
  const grapesBackendRef = useRef<GrapesJSBackend | null>(null);
  // 両 Backend (Puck / GrapesJS) 共通の EditorApi (#815 Codex Must-fix #2/#3 で統一)。
  // discard / serverChange reload / theme apply / captureThumbnail / getProjectData 等を
  // editorKind 非依存に呼ぶための窓口。両 Backend の onReady で expose される。
  const editorApiRef = useRef<EditorApi | null>(null);
  // GrapesJS pre-load 済み payload (#815 PR-C: 明示 load。null = 未ロード、それ以外は payload)
  const [grapesState, setGrapesState] = useState<EditorState | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpStatus>("disconnected");
  const tabId = makeTabId("design", screenId);

  // ダイアログ表示状態
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  // localStorage 救済確認ダイアログ
  const [showLegacyRescueDialog, setShowLegacyRescueDialog] = useState(false);
  const legacyDataRef = useRef<unknown>(null);
  // localStorage 救済は mount 1 回のみ
  const legacyRescueCheckedRef = useRef(false);

  const [panelMode, setPanelModeState] = useState<PanelMode>(() => {
    const saved = localStorage.getItem(PANEL_MODE_KEY) as PanelMode | null;
    return saved ?? "pinned";
  });
  const [prevMode, setPrevMode] = useState<"pinned" | "autohide">("pinned");
  const { showError } = useErrorDialog();

  const setPanelMode = useCallback((mode: PanelMode) => {
    setPanelModeState((cur) => {
      if (cur !== "hidden") setPrevMode(cur as "pinned" | "autohide");
      return mode;
    });
    localStorage.setItem(PANEL_MODE_KEY, mode);
  }, []);

  const togglePin = useCallback(() => {
    setPanelMode(panelMode === "pinned" ? "autohide" : "pinned");
  }, [panelMode, setPanelMode]);

  const closePanel = useCallback(() => setPanelMode("hidden"), [setPanelMode]);
  const openPanel = useCallback(() => setPanelMode(prevMode), [prevMode, setPanelMode]);

  // useEditSession — TableEditor:77 と同型
  const sessionId = mcpBridge.getSessionId();

  // P1-A fix (#908): editorKind が "puck" の場合は resourceType を "puck-data" にする。
  // editorKind 解決は非同期 (useEffect) のため、解決前は "screen" を仮置きし、
  // 解決後に正しい type を反映する。
  // 注意: useEditSession の resourceType が変わっても hook 内部 state (editSession/myRole) は
  // 自動リセットされない。startEditing は "編集開始" ボタン押下時に呼ばれるため、
  // editorKind 解決完了フラグ (editorKindResolved) で未解決中の startEditing をガードする。
  const [resolvedEditSessionResourceType, setResolvedEditSessionResourceType] = useState<"screen" | "puck-data">("screen");
  const [editorKindResolved, setEditorKindResolved] = useState(false);

  // URL ?session= 同期 (spec §11.2) — initialEditSessionId を useEditSession に渡すため先に呼ぶ
  const { syncSessionToUrl, initialEditSessionId: initialDesignSessionId } = useSessionUrlSync({
    resourceType: resolvedEditSessionResourceType,
    resourceId: screenId,
  });

  // P2-2 fix (#907): URL ?session= から復元した initialEditSessionId を渡す (URL 招待 attach 復活)
  // P2 fix (#908 round-5): editorKind 未解決中は session attach をスキップ (race 回避)。
  // 初回 render で resourceType: "screen" のまま attach すると、後で "puck-data" に変わっても
  // hook 内部 state は不整合のまま残る。resolved 後に正しい resourceType で attach する。
  const { editSession, mode, loading: sessionLoading, isDirtyForTab, actions: editActions, attach: editAttach, takeOver: editTakeOver, saveConflict, onSaveConflictOverwrite, onSaveConflictCancel } = useEditSession({
    resourceType: resolvedEditSessionResourceType,
    resourceId: screenId,
    sessionId,
    editSessionId: editorKindResolved ? initialDesignSessionId : undefined,
  });

  const isReadonly = mode.kind !== "editing";
  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  // dirty 連携: isDirtyForTab (編集セッション中) || isDirty (canvas 変更あり)
  useEffect(() => {
    setDirty(tabId, isDirtyForTab || isDirty);
  }, [tabId, isDirtyForTab, isDirty]);

  // resume ダイアログ: readonly + sessionLoading 解除後に draft があれば表示
  // Puck 画面は "puck-data" draft を確認し、GrapesJS 画面は "screen" draft を確認する
  // (editorKind は解決後に設定されるため、両方確認して OR で判定)
  useEffect(() => {
    if (!screenId || sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      // editorKind が puck なら puck-data draft を確認、それ以外 or 未解決なら screen draft も確認
      // workspace context が未確立の場合 WorkspaceUnsetError が返ることがあるため最大 25 回 retry する (200ms × 25 = 5s)
      for (let attempt = 0; attempt < 25 && !cancelled; attempt++) {
        try {
          const [screenSessions, puckSessions] = await Promise.all([
            mcpBridge.request("editSession.list", { resourceType: "screen", resourceId: screenId }) as Promise<{ sessions: unknown[] } | null>,
            mcpBridge.request("editSession.list", { resourceType: "puck-data", resourceId: screenId }) as Promise<{ sessions: unknown[] } | null>,
          ]);
          if (cancelled) return;
          // state === "Active" のみを対象とする (discarded session は表示しない)
          // NOTE (#980-A): 他エディタは participants[mySessionId] filter で「自分の session のみ」に絞っているが
          // Designer (GrapesJS) は HARD navigation (page.goto("/workspace/select")) で clientId が変わるため
          // navigation 後 「自分の draft」 を resume できなくなる。Designer は単一 user 単一 page UX が
          // メインの編集経路のため、ここでは any active session で dialog を出す旧来動作を維持する。
          // 多重 tab で他人の active session が混入するシナリオでは spec 側の dismiss loop で対処する。
          const screenHasDraft = (screenSessions?.sessions ?? []).some((s: unknown) => (s as { state?: string }).state === "Active");
          const puckHasDraft = (puckSessions?.sessions ?? []).some((s: unknown) => (s as { state?: string }).state === "Active");
          if (screenHasDraft || puckHasDraft) setShowResumeDialog(true);
          return;
        } catch (err) {
          if (cancelled) return;
          const msg = String((err as Error)?.message ?? err);
          if (!msg.includes("WorkspaceUnset") && !msg.includes("workspace not")) {
            console.error(err);
            return;
          }
          await new Promise(r => setTimeout(r, 200));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [screenId, sessionLoading, mode.kind]);

  // cssFramework と editorKind を画面 + プロジェクトから読み込む (screenId が変わるたびに再解決)。
  // 解決順序 (multi-editor-puck.md § 2.3 / css-framework-switching.md § 1.3.1 / #806 子 2/3):
  //   1. screen.design.* (画面個別指定)
  //   2. project.techStack.designer.* (project default)
  //   3. "bootstrap" / "grapesjs" (最終 default)
  // P1-A fix (#908): editorKind が決まったら resolvedEditSessionResourceType を更新する。
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadRawProject(),
      loadScreenEntity(screenId),
    ]).then(([raw, screen]) => {
      if (cancelled) return;
      const fw = resolveCssFramework(screen.design, raw.techStack);
      setCssFramework(fw);
      cssFrameworkRef.current = fw;
      const ek = resolveEditorKind(screen.design, raw.techStack);
      setEditorKind(ek);
      // P1-A: Puck 画面の editSession は "puck-data" branch を通すよう resourceType を更新する
      setResolvedEditSessionResourceType(ek === "puck" ? "puck-data" : "screen");
      setEditorKindResolved(true);
    }).catch((e) => {
      console.warn("[Designer] cssFramework/editorKind resolve failed, using defaults", e);
      // P2 fix (#908 round-6): metadata load 失敗時も defaults でレンダリングするので resolved にする。
      // 設定しないと editorKindResolved が永遠 false で handleStartEditing が silent no-op、
      // fallback 経路で編集ボタンが効かなくなる。
      if (!cancelled) setEditorKindResolved(true);
    });
    return () => { cancelled = true; };
  }, [screenId]);

  // cssFrameworkRef を cssFramework state と同期 (onReady closure から参照するため)
  useEffect(() => {
    cssFrameworkRef.current = cssFramework;
  }, [cssFramework]);

  const handleThemeChange = useCallback((themeId: ThemeId) => {
    setActiveThemeState(themeId);
    localStorage.setItem(THEME_KEY, themeId);
    editorApiRef.current?.applyTheme(themeId, cssFrameworkRef.current);
  // cssFrameworkRef は ref なので依存配列不要
  }, []);

  // editorKind 解決完了後のみ startEditing を許可するガードラップ
  // editorKind 解決前に startEditing が呼ばれると誤った resourceType で EditSession が
  // 作成される可能性があるため、解決まで待機する。
  const handleStartEditing = useCallback(async () => {
    if (!editorKindResolved) {
      console.warn("[Designer] startEditing called before editorKind resolved, skipping");
      return;
    }
    await editActions.startEditing();
  }, [editorKindResolved, editActions]);

  // isReadonly の ref 版 (Puck onChange handler 等の closure からアクセスするため)
  const isReadonlyRef = useRef(isReadonly);
  useEffect(() => {
    isReadonlyRef.current = isReadonly;
  }, [isReadonly]);

  // GrapesJS の draftRead — draft 優先 → 本体ファイル fallback (#815 PR-C: 明示 load)。
  // 破損データ (空 object / pages 欠落) を検知したら errorLog に痕跡を残す (#953):
  // GrapesJSEditorPane の ensureValidProject() でも recordError は呼ばれるが、
  // そちらは onGjsReady (= GrapesJS init 完了後) のため timing 上 setGrapesState
  // 後の UI 表示 (edit-mode-start visible) より遅い。本関数で早期検知する。
  const grapesDraftRead = useCallback(async (): Promise<unknown> => {
    try {
      const sessionsResult = await mcpBridge.request("editSession.list", { resourceType: "screen", resourceId: screenId }) as { sessions: Array<{ id: string }> } | null;
      if (sessionsResult && sessionsResult.sessions.length > 0) {
        const esId = sessionsResult.sessions[0].id;
        const payloadResult = await mcpBridge.request("editSession.fetchPayload", { editSessionId: esId }) as { payload: unknown } | null;
        if (payloadResult?.payload && typeof payloadResult.payload === "object" && Object.keys(payloadResult.payload).length > 0) {
          return payloadResult.payload;
        }
      }
    } catch {
      // MCP 未接続等で draft check 失敗 → 本体 fallback
    }
    try {
      const data = await mcpBridge.request("loadScreen", { screenId }) as Record<string, unknown> | null;
      if (data && typeof data === "object") {
        const keys = Object.keys(data);
        if (keys.length === 0) {
          // 空 object {} は破損データ扱い (#953)
          recordError({
            source: "manual",
            message: `画面データが空のため、空のプロジェクトで起動します (screenId=${screenId})`,
            context: { screenId, source: "designer/grapesDraftRead", keys: [] },
          });
          return null;
        }
        if (!Array.isArray(data.pages) || data.pages.length === 0) {
          // pages 欠落データは破損扱いで起動継続するが痕跡を残す (#953)
          recordError({
            source: "manual",
            message: `画面データの pages が欠落しています。デフォルト構造で補正しました (screenId=${screenId})`,
            context: { screenId, source: "designer/grapesDraftRead", keys },
          });
          // 補正は ensureValidProject に任せて raw を返す (補正の単一責任化)
        }
        return data;
      }
    } catch {
      // MCP error → null を返す (GrapesJSEditorPane で ensureValidProject 適用)
    }
    return null;
  }, [screenId]);

  // GrapesJS の reloadPayload — discard / serverChange reload 時に最新 payload を取得する
  const grapesReloadPayload = useCallback(async (): Promise<unknown> => {
    if (!grapesBackendRef.current) return null;
    try {
      const state = await grapesBackendRef.current.load(screenId, grapesDraftRead);
      return state.payload;
    } catch (e) {
      console.warn("[Designer] grapesReloadPayload failed", e);
      return null;
    }
  }, [screenId, grapesDraftRead]);

  // GrapesJS Backend.load() で初期 payload を pre-load する (#815 PR-C: 明示 load)。
  // editorKind === "grapesjs" のときのみ実行し、結果を grapesState に格納して renderEditor で使う。
  // screenId 変更時 (タブ切替) は最初に grapesState を null にクリアし、新 payload が来るまで
  // ローディング画面を表示することで stale payload で render しない (#815 Codex Must-fix #1)。
  useEffect(() => {
    if (editorKind !== "grapesjs") return;
    let cancelled = false;
    setGrapesState(null);
    editorApiRef.current = null;
    if (!grapesBackendRef.current) grapesBackendRef.current = new GrapesJSBackend();
    const backend = grapesBackendRef.current;
    backend.load(screenId, grapesDraftRead).then((state) => {
      if (cancelled) return;
      setGrapesState(state);
    }).catch((e) => {
      console.warn("[Designer] GrapesJSBackend.load failed", e);
      if (!cancelled) setGrapesState({ payload: null, ui: { screenId } });
    });
    return () => { cancelled = true; };
  }, [editorKind, screenId, grapesDraftRead]);

  // GrapesJS Backend からの ready 通知 — EditorApi を保持し legacy localStorage 救済を実行
  const handleGrapesReady = useCallback((api: EditorApi) => {
    editorApiRef.current = api;
    // 初期 theme 適用 (multi-editor-puck.md § 3 — Backend onReady 後に Designer.tsx が theme を当てる)
    api.applyTheme(activeTheme, cssFrameworkRef.current);
    // localStorage 救済チェック (mount 1 回のみ)
    if (!legacyRescueCheckedRef.current) {
      legacyRescueCheckedRef.current = true;
      checkLegacyLocalStorage(screenId).then((result) => {
        if (result.hasLegacy) {
          legacyDataRef.current = result.data;
          setShowLegacyRescueDialog(true);
        }
      }).catch(console.error);
    }
  }, [activeTheme, screenId]);

  // GrapesJS の screenChanged broadcast 受信通知 — dirty 中はバナー、clean なら即時 reload
  const handleGrapesServerChanged = useCallback(() => {
    if (isDirtyRef.current) {
      setServerChanged(true);
    } else {
      console.log("[Designer] screenChanged broadcast, reloading...");
      editorApiRef.current?.reload().catch(console.error);
    }
  }, []);

  // GrapesJS の markDirty signal — debounce で API.getProjectData() を取得して updateDraft する
  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleGrapesChange = useCallback(() => {
    if (isReadonlyRef.current) return;
    setIsDirtyState(true);
    isDirtyRef.current = true;
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      const data = editorApiRef.current?.getProjectData();
      if (data === undefined) return;
      if (editSession?.id) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: data }).catch(console.error);
      }
    }, 300);
  }, [screenId, editSession]);

  // タブがアクティブになったときにキャンバスをリフレッシュ（display:none から復帰）
  useEffect(() => {
    if (isActive) {
      editorApiRef.current?.refreshCanvas();
    }
  }, [isActive]);

  /**
   * P1 fix (#912): editSession.save 成功後 (通常 save と overwrite 両方) で共通に呼ぶ cleanup。
   * 通常 save: editActions.save() が conflict / failed でない場合に呼ぶ
   * overwrite: SaveConflictDialog の onOverwrite 内で onSaveConflictOverwrite() 後に呼ぶ
   */
  const commitAfterSave = useCallback(async () => {
    setIsDirtyState(false);
    isDirtyRef.current = false;
    setDirty(tabId, false);
    setServerChanged(false);
    await acknowledgeServerMtime("screen", screenId);
    // サムネイル生成 (GrapesJS のみ — Puck は API.captureThumbnail() が null を返す)
    const api = editorApiRef.current;
    if (api && !api.isCanvasEmpty()) {
      api.captureThumbnail().then(async (thumbnail) => {
        if (!thumbnail) return;
        try {
          const project = await loadProject();
          await updateScreenThumbnail(project, screenId, thumbnail);
        } catch {
          // サムネイル保存失敗は無視
        }
      });
    }
  }, [screenId, tabId]);

  /** 保存: 保留中の debounce を flush してから editSession.save */
  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    setIsSaving(true);
    try {
      if (editorKind === "puck") {
        // Puck 画面: pending payload を flush してから EditSession.save で確定保存 (#806 M-1, autosave廃止 D-1)
        // P1-2 fix (#907): puckPendingPayloadRef を読み出してから editSession.update 送信し、
        // その後 puckFlushRef でタイマーキャンセル + null クリア (送信前に clear すると null payload で save される)。
        const puckPending = puckPendingPayloadRef.current;
        if (puckPending !== null && puckPending !== undefined && editSession?.id) {
          await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: puckPending });
        }
        if (puckFlushRef.current) {
          puckFlushRef.current();
          puckFlushRef.current = null;
        }
        // P1 fix (#908): conflict 時は cleanup をスキップして clean 化を防ぐ。
        const puckSaveResult = await editActions.save();
        if (puckSaveResult.conflicted || puckSaveResult.failed) return;
      } else {
        // GrapesJS 画面: 保留中の debounce timer があれば即時 flush してから EditSession.save
        if (draftUpdateTimer.current) {
          clearTimeout(draftUpdateTimer.current);
          draftUpdateTimer.current = null;
          const data = editorApiRef.current?.getProjectData();
          if (data !== undefined && editSession?.id) {
            await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: data });
          }
        }
        // P1 fix (#908): conflict 時は cleanup をスキップして clean 化を防ぐ。
        const grapesJsSaveResult = await editActions.save();
        if (grapesJsSaveResult.conflicted || grapesJsSaveResult.failed) return;
      }
      await commitAfterSave();
    } catch (e) {
      console.error("[Designer] save failed:", e);
      showError({
        title: "画面の保存に失敗しました",
        error: e,
        context: { screenId, tabId },
      });
    } finally {
      setIsSaving(false);
    }
  }, [screenId, tabId, isReadonly, isSaving, editorKind, editActions, showError, editSession, commitAfterSave]);

  /** 破棄: discardDraft + releaseLock → 本体ファイル再読込 */
  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    try {
      // "screen" draft を discard (editActions.discard が処理)
      await editActions.discard();
      // GrapesJS は API.reload() で本体ファイル再読込 + UndoManager.clear() + reconcile を実行する
      await editorApiRef.current?.reload();
      setIsDirtyState(false);
      isDirtyRef.current = false;
      setDirty(tabId, false);
      setServerChanged(false);
      await acknowledgeServerMtime("screen", screenId);
    } catch (e) {
      console.error("[Designer] discard failed:", e);
      showError({
        title: "破棄に失敗しました",
        error: e,
        context: { screenId, tabId },
      });
    }
  }, [screenId, tabId, editActions, showError]);

  const handleForceRelease = useCallback(async () => {
    setShowForceReleaseDialog(false);
    await editActions.forceReleaseOther();
  }, [editActions]);

  const handleResumeContinue = useCallback(async () => {
    setShowResumeDialog(false);
    await handleStartEditing();
  }, [handleStartEditing]);

  const handleResumeDiscard = useCallback(async () => {
    setShowResumeDialog(false);
    // EditSession を破棄 (screen / puck-data 共通 — EditSession が持つ payload を含め全て破棄)
    await editActions.discard();
    await editorApiRef.current?.reload();
  }, [editActions]);

  // ServerChangeBanner からの reload はページ本体への戻り
  const handleServerChangeReload = useCallback(async () => {
    if (!editorApiRef.current) return;
    try {
      await editorApiRef.current.reload();
      setIsDirtyState(false);
      isDirtyRef.current = false;
      setDirty(tabId, false);
      setServerChanged(false);
      await acknowledgeServerMtime("screen", screenId);
    } catch (e) {
      console.error("[Designer] server change reload failed:", e);
    }
  }, [screenId, tabId]);

  // localStorage 救済: 採用
  const handleLegacyRescueAdopt = useCallback(async () => {
    setShowLegacyRescueDialog(false);
    try {
      await executeRescue(screenId, "adopt", legacyDataRef.current);
      legacyDataRef.current = null;
      // draft が作成されたのでリロードして draft を表示
      await editorApiRef.current?.reload();
      // resume ダイアログを表示 (draft が存在するので続きを選ばせる)
      setShowResumeDialog(true);
    } catch (e) {
      console.error("[Designer] legacy rescue adopt failed:", e);
    }
  }, [screenId]);

  // localStorage 救済: 破棄
  const handleLegacyRescueDiscard = useCallback(() => {
    setShowLegacyRescueDialog(false);
    clearLegacyLocalStorage(screenId);
    legacyDataRef.current = null;
  }, [screenId]);

  // Puck の draftRead — EditSession draft 優先 → 本体 puck-data.json fallback (#815 PR-C)
  const puckDraftRead = useCallback(async (): Promise<unknown> => {
    // M-2: 2 段フォールバック — EditSession draft → committed puck-data.json → EMPTY (#806)
    try {
      const sessionsResult = await mcpBridge.request("editSession.list", { resourceType: "puck-data", resourceId: screenId }) as { sessions: Array<{ id: string }> } | null;
      if (sessionsResult && sessionsResult.sessions.length > 0) {
        const esId = sessionsResult.sessions[0].id;
        const payloadResult = await mcpBridge.request("editSession.fetchPayload", { editSessionId: esId }) as { payload: unknown } | null;
        if (payloadResult?.payload !== null && payloadResult?.payload !== undefined) {
          return payloadResult.payload;
        }
      }
    } catch {
      // MCP 未接続等 → fallback
    }
    const committedData = await mcpBridge.loadPuckData(screenId);
    if (committedData !== null) return committedData;
    return null;
  }, [screenId]);

  // Puck の reloadPayload — discard / serverChange reload 時に Puck 側へ最新 payload を反映する
  // (#815 Codex Must-fix #2/#3: Puck も EditorApi.reload() で再ロードするための関数)
  const puckReloadPayload = useCallback(async (): Promise<unknown> => {
    if (!puckBackendRef.current) return null;
    try {
      const state = await puckBackendRef.current.load(screenId, puckDraftRead);
      return state.payload;
    } catch (e) {
      console.warn("[Designer] puckReloadPayload failed", e);
      return null;
    }
  }, [screenId, puckDraftRead]);

  // Puck Backend からの ready 通知 — EditorApi を保持 (両 Backend 共通の窓口)
  const handlePuckReady = useCallback((api: EditorApi) => {
    editorApiRef.current = api;
  }, []);

  // Puck Backend の load — payload を取得して puckState にセット。
  // 描画は React render 時に backend.renderEditor() の戻り値 (ReactNode) を使う (#815)。
  // editorKind === "puck" のときのみ実行する。
  useEffect(() => {
    if (editorKind !== "puck") return;
    let cancelled = false;
    setPuckState(null);
    editorApiRef.current = null;
    if (!puckBackendRef.current) puckBackendRef.current = new PuckBackend();
    const backend = puckBackendRef.current;

    // puckFlushRef にフラッシュ関数を登録 (handleSave が呼ぶ)。
    // pending payload + timer は ref 経由で保持し、handleSave / unmount から参照可能にする。
    // autosave 廃止 (D-1) のため、flush は pending timer のキャンセルのみ。handleSave が editActions.save() を呼ぶ。
    puckFlushRef.current = () => {
      if (puckPendingTimerRef.current !== null) {
        clearTimeout(puckPendingTimerRef.current);
        puckPendingTimerRef.current = null;
      }
      puckPendingPayloadRef.current = null;
    };

    backend
      .load(screenId, puckDraftRead)
      .then((state) => {
        if (cancelled) return;
        setPuckState(state);
      })
      .catch((e) => {
        console.warn("[Designer] PuckBackend.load failed", e);
      });

    return () => {
      cancelled = true;
      puckFlushRef.current = null;
      if (puckPendingTimerRef.current !== null) {
        clearTimeout(puckPendingTimerRef.current);
        puckPendingTimerRef.current = null;
      }
      puckPendingPayloadRef.current = null;
    };
  }, [editorKind, screenId, puckDraftRead]);

  // Puck onChange handler — dirty 状態を更新する。autosave 廃止 (D-1) のため debounce updateDraft は行わない。
  const handlePuckChange = useCallback(
    (newState: EditorState) => {
      if (isReadonlyRef.current) return;
      setIsDirtyState(true);
      isDirtyRef.current = true;
      puckPendingPayloadRef.current = newState.payload;
    },
    [],
  );

  // Puck 画面の cross-tab 上書き保護 (Sh-1: puckDataChanged broadcast 購読)。
  // GrapesJS は screenChanged broadcast を購読して ServerChangeBanner を表示するのと同等。
  // Puck 画面でも他タブが puck-data.json を commit した際に ServerChangeBanner を表示する。
  useEffect(() => {
    if (editorKind !== "puck") return;
    const unsubPuckChanged = mcpBridge.onBroadcast("puckDataChanged", (data) => {
      const d = data as { screenId?: string };
      if (d.screenId !== screenId) return;
      if (isDirtyRef.current) {
        setServerChanged(true);
      } else {
        console.log("[Designer] puckDataChanged broadcast, marking server changed...");
        setServerChanged(true);
      }
    });
    return () => { unsubPuckChanged(); };
  }, [editorKind, screenId]);

  // ---------------------------------------------------------------------------
  // 共通ダイアログ群 (GrapesJS / Puck 両方で使う)
  // ---------------------------------------------------------------------------
  const commonDialogs = (
    <>
      {/* 編集モードツールバー */}
      <EditModeToolbar
        mode={mode}
        onStartEditing={handleStartEditing}
        onSave={handleSave}
        onDiscardClick={() => setShowDiscardDialog(true)}
        onForceReleaseClick={() => setShowForceReleaseDialog(true)}
        saving={isSaving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />

      {/* 強制解除 / ForcedOut / AfterForceUnlock ダイアログ */}
      {mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={mode.previousDraftExists}
          onChoice={(choice) => editActions.handleForcedOut(choice)}
        />
      )}
      {mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={mode.previousOwner}
          onChoice={(choice) => editActions.handleAfterForceUnlock(choice)}
        />
      )}

      {showResumeDialog && (
        <ResumeOrDiscardDialog
          onResume={handleResumeContinue}
          onDiscard={handleResumeDiscard}
          onCancel={() => setShowResumeDialog(false)}
        />
      )}

      {showDiscardDialog && (
        <DiscardConfirmDialog
          onConfirm={handleDiscard}
          onCancel={() => setShowDiscardDialog(false)}
        />
      )}

      {showForceReleaseDialog && lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={lockedByOther.ownerSessionId}
          onConfirm={handleForceRelease}
          onCancel={() => setShowForceReleaseDialog(false)}
        />
      )}

      {showLegacyRescueDialog && (
        <LegacyRescueDialog
          onAdopt={handleLegacyRescueAdopt}
          onDiscard={handleLegacyRescueDiscard}
        />
      )}

      {saveConflict && (
        <SaveConflictDialog
          conflict={saveConflict}
          onOverwrite={async () => {
            try {
              await onSaveConflictOverwrite();
              await commitAfterSave();
            } catch (e) {
              console.error("[Designer] save overwrite failed:", e);
            }
          }}
          onCancel={onSaveConflictCancel}
        />
      )}

      {serverChanged && (
        <ServerChangeBanner
          onReload={handleServerChangeReload}
          onDismiss={() => setServerChanged(false)}
        />
      )}
    </>
  );

  // ---------------------------------------------------------------------------
  // Puck エディタ表示 (#806 子 3 / #815 で Backend.renderEditor 統一形に移行)
  // editorKind === "puck" のときは PuckBackend.renderEditor() の戻り値 (ReactNode) を render する。
  // GrapesJS 固有の GjsEditor / WithEditor / BlocksProvider は使用しない。
  // ---------------------------------------------------------------------------
  if (editorKind === "puck") {
    if (!puckState || !puckBackendRef.current) {
      return (
        <div className="loading-screen">
          <div className="spinner" />
          <p>エディタを起動中...</p>
        </div>
      );
    }
    // Puck 経路: <GjsEditor> ancestor が無いため editor は undefined 固定で props 渡し。
    // GrapesJS 経路と異なり Provider-aware ブリッジは不要 (#824)。
    const puckSubToolbar = (
      <DesignSubToolbar
        panelMode={panelMode}
        onOpenPanel={openPanel}
        activeTheme={activeTheme}
        onThemeChange={handleThemeChange}
        mcpStatus={mcpStatus}
        isDirty={isDirty}
        isSaving={isSaving}
        onSaveToFile={handleSave}
        onReset={async () => setShowDiscardDialog(true)}
        backLink={onBack ? { label: screenName ?? "画面デザイン", onClick: onBack } : undefined}
        screenId={screenId}
        isReadonly={isReadonly}
        editor={undefined}
        sessionMode={mode}
        sessionId={sessionId}
        onStartEditing={handleStartEditing}
        onViewerAttached={syncSessionToUrl}
        onAttachAsView={editAttach}
        onTakeOver={editTakeOver}
      />
    );
    const puckProps: PuckRenderEditorProps = {
      state: puckState,
      cssFramework,
      themeVariant: activeTheme,
      isReadonly,
      subToolbarSlot: puckSubToolbar,
      dialogsSlot: commonDialogs,
      panelMode,
      onTogglePin: togglePin,
      onClosePanel: closePanel,
      screenId,
      onStartEditing: handleStartEditing,
      onChange: handlePuckChange,
      onReady: handlePuckReady,
      // Puck も EditorApi.reload() で再ロードできるよう reloadPayload を提供
      // (#815 Codex Must-fix #2/#3: discard / serverChange reload を Puck/GrapesJS で統一)
      reloadPayload: puckReloadPayload,
    };
    return puckBackendRef.current.renderEditor(puckProps);
  }

  // ---------------------------------------------------------------------------
  // GrapesJS エディタ表示 (既存挙動を維持)
  // ---------------------------------------------------------------------------
  // GrapesJS Backend.load() の結果待ち (#815 PR-C: 明示 load — autoload 廃止)
  if (!grapesState || !grapesBackendRef.current) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>デザイナーを起動中...</p>
      </div>
    );
  }
  // GrapesJS 経路: GrapesJSEditorPane の <WithEditor> 配下に render されるため、
  // Provider-aware ブリッジが useEditorMaybe() を Rules-of-Hooks 準拠で呼んで forward する (#824)。
  const grapesSubToolbar = (
    <DesignSubToolbarGrapesJSBridge
      panelMode={panelMode}
      onOpenPanel={openPanel}
      activeTheme={activeTheme}
      onThemeChange={handleThemeChange}
      mcpStatus={mcpStatus}
      isDirty={isDirty}
      isSaving={isSaving}
      onSaveToFile={handleSave}
      onReset={async () => setShowDiscardDialog(true)}
      backLink={onBack ? { label: screenName ?? "画面デザイン", onClick: onBack } : undefined}
      screenId={screenId}
      isReadonly={isReadonly}
      sessionMode={mode}
      sessionId={sessionId}
      onStartEditing={handleStartEditing}
      onViewerAttached={syncSessionToUrl}
      onAttachAsView={editAttach}
      onTakeOver={editTakeOver}
    />
  );
  // GrapesJSRenderEditorProps で GrapesJS 固有 callback を型レベル required として渡す
  // (#815 Codex Should-fix #1: Generics 化で共通 interface への混入を解消)。
  const grapesProps: GrapesJSRenderEditorProps = {
    state: grapesState,
    cssFramework,
    themeVariant: activeTheme,
    isReadonly,
    subToolbarSlot: grapesSubToolbar,
    dialogsSlot: commonDialogs,
    panelMode,
    onTogglePin: togglePin,
    onClosePanel: closePanel,
    screenId,
    onStartEditing: handleStartEditing,
    onChange: handleGrapesChange,
    onReady: handleGrapesReady,
    onServerChanged: handleGrapesServerChanged,
    onMcpStatusChange: setMcpStatus,
    onExternalThemeChange: handleThemeChange,
    reloadPayload: grapesReloadPayload,
  };
  return <>{grapesBackendRef.current.renderEditor(grapesProps)}</>;
}

// ---------------------------------------------------------------------------
// LocalStorage 救済確認ダイアログ
// ---------------------------------------------------------------------------

interface LegacyRescueDialogProps {
  onAdopt: () => void;
  onDiscard: () => void;
}

function LegacyRescueDialog({ onAdopt, onDiscard }: LegacyRescueDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDiscard();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onDiscard]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="edit-mode-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onDiscard(); }}
      role="presentation"
    >
      <div
        className="edit-mode-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-rescue-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="edit-mode-modal-header">
          <h5 id="legacy-rescue-title" className="edit-mode-modal-title">
            未保存の旧データが見つかりました
          </h5>
          <button
            type="button"
            className="btn-close"
            onClick={onDiscard}
            aria-label="閉じる"
          />
        </div>
        <div className="edit-mode-modal-body">
          <p>
            以前の編集セッションで保存されなかったデータ (localStorage) が残っています。
            draft に変換して編集を継続しますか？
          </p>
          <div className="edit-mode-modal-footer">
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={onDiscard}
              data-testid="legacy-rescue-discard"
            >
              破棄する
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onAdopt}
              data-testid="legacy-rescue-adopt"
            >
              draft に変換して続ける
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
