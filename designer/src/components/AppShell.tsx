import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, useLocation, useNavigate, matchPath, useParams, Outlet } from "react-router-dom";
import { FlowEditor } from "./flow/FlowEditor";
import { ScreenListView } from "./flow/ScreenListView";
import { TableListView } from "./table/TableListView";
import { TableEditor } from "./table/TableEditor";
import { ErDiagram } from "./table/ErDiagram";
import { ProcessFlowListView } from "./process-flow/ProcessFlowListView";
import { ProcessFlowEditor } from "./process-flow/ProcessFlowEditor";
import { ExtensionsPanel } from "./extensions/ExtensionsPanel";
import { ConventionsCatalogView } from "./conventions/ConventionsCatalogView";
import { ScreenItemsView } from "./screen-items/ScreenItemsView";
import { SequenceListView } from "./sequence/SequenceListView";
import { SequenceEditor } from "./sequence/SequenceEditor";
import { ViewListView } from "./view/ViewListView";
import { ViewEditor } from "./view/ViewEditor";
import { ViewDefinitionListView } from "./view-definition/ViewDefinitionListView";
import { ViewDefinitionEditor } from "./view-definition/ViewDefinitionEditor";
import { WorkspaceListView } from "./workspace/WorkspaceListView";
import { WorkspaceSelectView } from "./workspace/WorkspaceSelectView";
import { Designer } from "./Designer";
import { DashboardView } from "./dashboard/DashboardView";
import { TabBar } from "./TabBar";
import { CommonHeader } from "./CommonHeader";
import { mcpBridge } from "../mcp/mcpBridge";
import { loadProject } from "../store/flowStore";
import { loadTable } from "../store/tableStore";
import { loadProcessFlow } from "../store/processFlowStore";
import { loadSequence } from "../store/sequenceStore";
import { loadView } from "../store/viewStore";
import { loadViewDefinition } from "../store/viewDefinitionStore";
import {
  getTabs,
  getActiveTabId,
  subscribe,
  openTab,
  setActiveTab,
  closeTab,
  makeTabId,
  clearPersistedTabs,
  type TabItem,
  type TabType,
} from "../store/tabStore";
import {
  getState as getWorkspaceState,
  subscribe as subscribeWorkspace,
  loadWorkspaces,
  subscribeWorkspaceChanges,
} from "../store/workspaceStore";
import { useTabKeyboard } from "../hooks/useTabKeyboard";
import { ErrorBoundary } from "./common/ErrorBoundary";
import { TabErrorFallback } from "./common/ErrorFallback";
import { ResourceLoading } from "./common/ResourceLoading";
import { useErrorDialog } from "./common/ErrorDialogProvider";
import { recordError } from "../utils/errorLog";
import { checkRedirect, subscribeRedirectGuardTrip, isRedirectGuardTripped } from "../utils/redirectGuard";
import { uiInfo, uiWarn, setupServerLogFlush } from "../utils/uiLog";

function useTabs() {
  const [tabs, setTabs] = useState<readonly TabItem[]>(getTabs);
  const [activeTabId, setActiveTabIdState] = useState(getActiveTabId);
  useEffect(() => {
    return subscribe(() => {
      setTabs(getTabs());
      setActiveTabIdState(getActiveTabId());
    });
  }, []);
  return { tabs, activeTabId };
}

// ─── WorkspaceScopedShell ─────────────────────────────────────────────────────
// /w/:wsId 配下の親レイアウト。React Router v7 の **nested Routes**
// (子要素を親 Route の children として宣言する形式) で使う。
// 子 Route の element はここで <Outlet /> によりレンダされる。
//
// 履歴: 以前は AppShellInner 内部で descendant <Routes> を使っていたが、
// React Router v7 では descendant <Routes> + <Route index> + 同階層の
// relative-path siblings の組合せで index 側が常に勝つ挙動を踏み、
// `/w/<id>/screen/flow` でも DashboardView が出続けるバグになっていた
// (2026-05-04 dogfood 検証で発覚)。Outlet パターンに統一して解消。
function WorkspaceScopedShell() {
  const { wsId } = useParams<{ wsId: string }>();
  return <AppShellInner wsId={wsId} />;
}

// redirectGuard が trip した時、画面全体に被せる赤バナー (#750 review S-2)。
// silently block すると見かけ上「画面が固まった」状態でユーザーが原因を理解できない。
function RedirectGuardBanner({ summary }: { summary: readonly string[] }) {
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: "#b71c1c", color: "#fff",
      padding: "12px 16px", fontSize: 13,
      borderBottom: "2px solid #7f0000",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    }}>
      <strong><i className="bi bi-exclamation-octagon-fill" /> リダイレクトループ検出 — 遷移を停止しました</strong>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9 }}>
        サーバ保護のため、これ以降のページ遷移を全てブロックしています。
        ブラウザを手動で再読み込み (F5) してください。
      </div>
      {summary.length > 0 && (
        <details style={{ marginTop: 6, fontSize: 11, fontFamily: "monospace" }}>
          <summary style={{ cursor: "pointer" }}>直近の遷移先 (バグ報告用)</summary>
          <ol style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {summary.map((p, i) => (<li key={i}>{p}</li>))}
          </ol>
        </details>
      )}
    </div>
  );
}

// designer-mcp 接続失敗エラー画面 (#795-C)
// splash で永遠に止まらず、サーバ未起動 / half-dead / network 障害を明示的に伝える
function ConnectionFailedView({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", flexDirection: "column", gap: "16px", padding: "24px",
      color: "var(--muted-text, #ccc)",
      backgroundColor: "var(--bg-color, #1a1a1a)",
    }}>
      <div style={{ fontSize: "3rem", color: "#dc3545" }}>
        <i className="bi bi-plug-fill" />
      </div>
      <h2 style={{ margin: 0, fontSize: "1.25rem", color: "var(--text-color, #fff)" }}>
        designer-mcp サーバに接続できません
      </h2>
      <div style={{
        maxWidth: 480, fontSize: "0.875rem", lineHeight: 1.6,
        color: "var(--muted-text, #aaa)", textAlign: "center",
      }}>
        <p style={{ marginTop: 0 }}>
          designer-mcp サーバ (port 5179) が起動しているか確認してください。
        </p>
        <pre style={{
          background: "rgba(255,255,255,0.05)", padding: "12px 16px", borderRadius: 6,
          fontSize: "0.8125rem", textAlign: "left", margin: "12px auto",
        }}>cd designer-mcp{"\n"}npm run dev</pre>
        <p style={{ margin: "12px 0 0" }}>
          すでに起動している場合は、port 5179 を別プロセスが握っている可能性があります。
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "8px 24px", fontSize: "0.9375rem",
          background: "#0d6efd", color: "#fff", border: "none", borderRadius: 6,
          cursor: "pointer", marginTop: 8,
        }}
      >
        <i className="bi bi-arrow-clockwise" style={{ marginRight: 6 }} />
        再試行
      </button>
    </div>
  );
}

// ルートレベルの AppShell: /workspace/* と /w/:wsId/* に分岐
const CONNECTION_TIMEOUT_MS = 5000; // designer-mcp 接続失敗エラー UI 表示までの待機時間 (#795-C)

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [workspaceState, setWorkspaceState] = useState(getWorkspaceState());
  const [guardTripped, setGuardTripped] = useState<readonly string[] | null>(
    isRedirectGuardTripped() ? [] : null,
  );
  // designer-mcp 接続失敗の可視化 (#795-C): N 秒以内に "connected" が来ない場合 true
  const [connectionFailed, setConnectionFailed] = useState(false);
  // 一度でも connected になったかを保持 (timer 内 closure 用)
  const everConnectedRef = useRef(false);
  // timeout timer の制御用 ref (retry 時に reset するため)
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeWorkspace(() => setWorkspaceState(getWorkspaceState()));
  }, []);
  useEffect(() => {
    return subscribeRedirectGuardTrip((summary) => setGuardTripped(summary));
  }, []);

  // 接続失敗 timer 起動 (mount 時 + retry 時)。タイムアウト時は mcpBridge.markFailed() を呼んで
  // status="failed" に遷移 → onStatusChange で connectionFailed=true を立てる (#795-C)
  const startConnectionTimeout = useCallback(() => {
    if (failTimerRef.current !== null) clearTimeout(failTimerRef.current);
    failTimerRef.current = setTimeout(() => {
      if (!everConnectedRef.current) {
        uiWarn("workspace", "connection-timeout", { ms: CONNECTION_TIMEOUT_MS });
        (mcpBridge as { markFailed: () => void }).markFailed();
      }
    }, CONNECTION_TIMEOUT_MS);
  }, []);

  // MCP 接続のライフサイクル単一所有 (元は AppShellInner にあったが、初期 / URL アクセス時には
  // AppShellInner がマウントされず splash で停滞するため外側 AppShell に移動。outer AppShell は
  // root component なので app の生存期間中マウントされ続ける):
  //  - mount 時に startWithoutEditor() を 1 度呼んで能動起動
  //  - "connected" 受信で loadWorkspaces して active state を最新化 (loading=true → false)
  //  - "failed" 受信でエラー UI に切替 (タイムアウト経路) (#795-C)
  //  - "disconnected" は mcpBridge 自身が retry timer を回すので AppShell は何もしない
  //  - サーバ側物理ログへの定期 flush もここで設定 (#750 follow-up)
  useEffect(() => {
    const unsubBroadcast = subscribeWorkspaceChanges();
    const bridge = mcpBridge as unknown as {
      onStatusChange: (cb: (s: string) => void) => () => void;
      startWithoutEditor: () => void;
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    const unsubStatus = bridge.onStatusChange((s) => {
      if (s === "connected") {
        everConnectedRef.current = true;
        setConnectionFailed(false);
        if (failTimerRef.current !== null) {
          clearTimeout(failTimerRef.current);
          failTimerRef.current = null;
        }
        loadWorkspaces().catch(console.error);
      } else if (s === "failed") {
        setConnectionFailed(true);
      }
    });
    bridge.startWithoutEditor();
    startConnectionTimeout();
    const unsubFlush = setupServerLogFlush((entries) =>
      bridge.request("client.log.flush", { entries }),
    );
    return () => {
      if (failTimerRef.current !== null) clearTimeout(failTimerRef.current);
      unsubBroadcast();
      unsubStatus();
      unsubFlush();
    };
  }, [startConnectionTimeout]);

  // 接続失敗時の手動 retry (#795-C エラー UI ボタン)
  const handleRetryConnection = useCallback(() => {
    uiInfo("workspace", "connection-retry-clicked");
    everConnectedRef.current = false;
    setConnectionFailed(false);
    startConnectionTimeout();
    (mcpBridge as { startWithoutEditor: () => void }).startWithoutEditor();
  }, [startConnectionTimeout]);

  // workspace が loading 完了後に URL を判定してリダイレクト
  useEffect(() => {
    if (workspaceState.loading) return;
    // /workspace/select や /workspace/list は常に許可
    if (location.pathname.startsWith("/workspace/")) return;
    // /w/:wsId/* 配下は WorkspaceScopedShell が処理
    if (location.pathname.startsWith("/w/")) return;
    // それ以外 (/, /screen/flow 等の旧 URL) は active があれば /w/<id>/<元パス> に、なければ /workspace/select に
    let target: string | null = null;
    if (workspaceState.active?.id) {
      target = `/w/${workspaceState.active.id}${location.pathname === "/" ? "/" : location.pathname}`;
    } else if (!workspaceState.lockdown) {
      target = "/workspace/select";
    }
    if (target) {
      const guard = checkRedirect(target);
      if (guard.allow) navigate(target, { replace: true });
    }
  }, [workspaceState.loading, workspaceState.active?.id, workspaceState.lockdown, location.pathname]);

  // loading 中はスプラッシュ表示 (WorkspaceScopedShell に合わせて一貫性確保)
  // ただし接続失敗 timeout 超過時はエラー UI に切替 (#795-C)
  if (workspaceState.loading) {
    if (connectionFailed) {
      return <ConnectionFailedView onRetry={handleRetryConnection} />;
    }
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: "8px",
        color: "var(--muted-text, #888)",
      }}>
        <i className="bi bi-hourglass-split" style={{ fontSize: "1.5rem" }} />
        <p style={{ margin: 0 }}>ワークスペース情報を読み込み中...</p>
      </div>
    );
  }

  return (
    <>
      {guardTripped !== null && <RedirectGuardBanner summary={guardTripped} />}
    <Routes>
      {/* /w/:wsId 配下の全ルートを **nested Routes** で宣言。
          React Router v7 ではこの書き方で初めて
            - <Route index> は parent path に exactly match した時のみ発火
            - 子 path は parent pathnameBase 配下で相対解決
          が正しく動く。以前の descendant <Routes> + <Route path="/w/:wsId/*">
          + <Route index> の組合せだと index 側が常に勝つバグがあった。
          AppShellInner では <Outlet /> で子 element をレンダする。 */}
      <Route path="/w/:wsId" element={<WorkspaceScopedShell />}>
        <Route index element={<DashboardView />} />
        <Route path="screen/flow" element={<FlowEditor />} />
        <Route path="screen/list" element={<ScreenListView />} />
        {/* design は designTabs 経由で別レンダーされるが、
             URL→タブ同期 effect の解決中に一瞬こちらのブランチが描画される。
             以前は element={null} で真っ白だったのを ResourceLoading に置換 (#124) */}
        <Route path="screen/design/:screenId" element={<ResourceLoading kind="screen" />} />
        <Route path="table/list" element={<TableListView />} />
        <Route path="table/edit/:tableId" element={<TableEditor />} />
        <Route path="table/er" element={<ErDiagram />} />
        <Route path="process-flow/list" element={<ProcessFlowListView />} />
        <Route path="process-flow/edit/:processFlowId" element={<ProcessFlowEditor />} />
        <Route path="extensions" element={<ExtensionsPanel />} />
        <Route path="conventions/catalog" element={<ConventionsCatalogView />} />
        <Route path="screen/items/:screenId" element={<ScreenItemsView />} />
        <Route path="sequence/list" element={<SequenceListView />} />
        <Route path="sequence/edit/:sequenceId" element={<SequenceEditor />} />
        <Route path="view/list" element={<ViewListView />} />
        <Route path="view/edit/:viewId" element={<ViewEditor />} />
        <Route path="view-definition/list" element={<ViewDefinitionListView />} />
        <Route path="view-definition/edit/:viewDefinitionId" element={<ViewDefinitionEditor />} />
      </Route>
      <Route path="/workspace/list" element={<WorkspaceListView />} />
      <Route path="/workspace/select" element={<WorkspaceSelectView />} />
      {/* 旧 URL (/, /screen/flow 等) にもスプラッシュで対応
          useEffect の redirect が動くまでの僅かな間のレンダー用 */}
      <Route path="*" element={
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100vh", flexDirection: "column", gap: "8px",
          color: "var(--muted-text, #888)",
        }}>
          <i className="bi bi-hourglass-split" style={{ fontSize: "1.5rem" }} />
          <p style={{ margin: 0 }}>ページを読み込み中...</p>
        </div>
      } />
    </Routes>
    </>
  );
}

function AppShellInner({ wsId }: { wsId: string | undefined }) {
  const { tabs, activeTabId } = useTabs();
  const location = useLocation();
  const navigate = useNavigate();
  const { showError } = useErrorDialog();
  useTabKeyboard();

  // ワークスペース状態管理
  const [workspaceState, setWorkspaceState] = useState(getWorkspaceState());
  useEffect(() => {
    return subscribeWorkspace(() => setWorkspaceState(getWorkspaceState()));
  }, []);

  // MCP 接続のライフサイクルは外側 AppShell が単一所有する (#676 review)。
  // 初期 / URL アクセス時に AppShellInner はマウントされない (splash で外側が停滞するため)
  // 経路で deadlock した regression 修正 — 外側 AppShell の useEffect に移動済。

  // workspace state 変化を log 化 (ループ追跡用)
  useEffect(() => {
    uiInfo("workspace", "state-change", {
      loading: workspaceState.loading,
      activeId: workspaceState.active?.id ?? null,
      lockdown: workspaceState.lockdown,
      error: workspaceState.error,
    });
  }, [workspaceState.loading, workspaceState.active?.id, workspaceState.lockdown, workspaceState.error]);

  // workspace.changed → ストア / 描画中 view を完全に破棄するためページ再読込。
  // per-resource タブを閉じるだけでは singleton stores (flowStore, tableStore 等) と
  // 現在マウント中の singleton view (DashboardView, ScreenListView 等) が旧 workspace の
  // データを保持し、その状態から保存すると新 workspace に旧データが混入するため。
  //
  // 重要: 初回 hydration (起動時の自動 active 設定: store の初期 null → 復元された id) は
  // 「切替」ではないのでリロードしない。リロード対象は prev が non-null だった場合のみ。
  // null → non-null をリロードすると、リロード後また初期 null に戻り再 hydration → 再リロードで
  // 無限ループになる。
  const prevActiveWorkspaceIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentId = workspaceState.active?.id ?? null;
    if (prevActiveWorkspaceIdRef.current === undefined) {
      // 1 回目の effect 実行: 記録のみ
      prevActiveWorkspaceIdRef.current = currentId;
      return;
    }
    if (prevActiveWorkspaceIdRef.current === currentId) return;
    if (prevActiveWorkspaceIdRef.current === null) {
      // null → non-null: 初回 hydration (backend の auto-restore など)。
      // 既存 store / view は new workspace のデータでまだ何も染まっていないのでリロード不要。
      prevActiveWorkspaceIdRef.current = currentId;
      return;
    }
    // non-null → 別の non-null / null: ユーザー操作による workspace 切替 / 閉じる
    prevActiveWorkspaceIdRef.current = currentId;
    const perResourceTypes: TabType[] = ["design", "table", "process-flow", "sequence", "view", "view-definition", "screen-items"];
    const dirtyLabels = getTabs()
      .filter((t) => t.isDirty && perResourceTypes.includes(t.type))
      .map((t) => t.label);
    if (dirtyLabels.length > 0) {
      console.warn(`[workspace] 未保存タブを強制破棄: ${dirtyLabels.join(", ")}`);
    }
    // localStorage に永続化された旧 workspace のタブ / GrapesJS screen キャッシュを破棄してから reload。
    // これを怠ると、reload 後にタブ復元 → URL sync で旧 resource ID へ navigate → 切替先 workspace に
    // 同 ID があれば stale 表示・誤保存、無ければ dashboard fallback、というバグになる。
    clearPersistedTabs();
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("gjs-")) localStorage.removeItem(k);
      }
    } catch { /* private browsing / quota error は無視 */ }
    // workspace 切替: navigate で URL を /w/<新wsId>/ に更新してから reload。
    // store のリセットは reload が担う (store.resetForWorkspaceSwitch 未実装のため reload 方式を維持)。
    const targetPath = currentId ? `/w/${currentId}/` : "/workspace/select";
    uiInfo("workspace", "switch-reload", { from: prevActiveWorkspaceIdRef.current, to: currentId, targetPath });
    // 万一 workspace.changed broadcast が暴走した場合の保険: redirectGuard を通す
    const guard = checkRedirect(targetPath);
    if (!guard.allow) {
      uiWarn("guard", "workspace switch reload を redirectGuard で抑止 (暴走防止)", { targetPath });
      return;
    }
    // location.href を直接書き換えることで URL 変更 + 完全リロードを一発で実現
    window.location.href = targetPath;
  }, [workspaceState.active?.id]);

  // ルーティングガード: wsId が active と異なる、または active===null の場合の処理
  // backend オフライン時は error が立つ → ガードを停止して localStorage fallback 経路を温存する。
  // (AGENTS.md "If WS disconnected → localStorage" の互換性確保)
  useEffect(() => {
    if (workspaceState.loading) return; // ロード中は判定しない
    if (workspaceState.lockdown) return; // lockdown 時はガード不要 (常にアクティブ扱い)
    if (workspaceState.error !== null) return; // load 失敗 (offline 等) は redirect しない

    if (workspaceState.active === null) {
      // active なし → /workspace/select
      // /workspace/* パスは AppShell の上位 Route で処理済みのため、
      // ここは /w/:wsId/* 配下の場合のみ
      const guard = checkRedirect("/workspace/select");
      if (guard.allow) navigate("/workspace/select", { replace: true });
    } else if (wsId && wsId !== workspaceState.active.id) {
      // URL の :wsId が現在 active と異なる → workspace.open で同期
      const recentEntry = workspaceState.workspaces.find((w) => w.id === wsId);
      if (recentEntry) {
        mcpBridge.request("workspace.open", { id: wsId }).catch((err) => {
          console.error("[workspace] workspace.open from URL failed:", err);
          const guard = checkRedirect("/workspace/select");
          if (guard.allow) navigate("/workspace/select", { replace: true });
        });
      } else {
        // recent にない不正 wsId → /workspace/select
        const guard = checkRedirect("/workspace/select");
        if (guard.allow) navigate("/workspace/select", { replace: true });
      }
    }
  }, [workspaceState.active, workspaceState.active?.id, workspaceState.loading, workspaceState.lockdown, workspaceState.error, workspaceState.workspaces, wsId, location.pathname]);

  // CSS variables でヘッダー・タブバーの高さを各コンポーネントに伝える
  useEffect(() => {
    document.documentElement.style.setProperty("--common-header-h", "40px");
  }, []);

  useEffect(() => {
    const h = tabs.length > 0 ? "32px" : "0px";
    document.documentElement.style.setProperty("--tabbar-h", h);
  }, [tabs.length]);

  // リソース詳細 URL で対象が見つからなかったときにダッシュボードへ戻す共通処理。
  // ブラウザが握っている URL を「存在しないリソース」のまま放置すると次回リロードで
  // また袋小路に入るため、URL 自体も / に書き換える。
  const fallbackToDashboard = (kind: string, id: string) => {
    const msg = `URL が指すリソース (${kind}: ${id}) が見つかりません。ダッシュボードへフォールバック。`;
    uiWarn("urlsync", "resource not found → fallback", { kind, id, pathname: location.pathname });
    recordError({
      source: "manual",
      message: msg,
      context: { kind, id, pathname: location.pathname },
    });
    showError({
      title: `${kind}が見つかりません`,
      message: `指定された${kind} (${id}) は存在しないか削除されています。ダッシュボードに戻ります。`,
      context: { kind, id, pathname: location.pathname },
      skipLogRecord: true, // 直前に recordError 済み
    });
    const dashPath = wsId ? `/w/${wsId}/` : "/";
    const guard = checkRedirect(dashPath);
    if (guard.allow) navigate(dashPath, { replace: true });
  };

  // URL → タブ同期（ブラウザの直接ナビゲーション / mcpBridge.navigateScreen）
  // /w/:wsId/* 配下で使用するため、全 matchPath を /w/:wsId/... 規約に更新
  useEffect(() => {
    uiInfo("urlsync", "pathname change", { pathname: location.pathname });
    const designMatch = matchPath("/w/:wsId/screen/design/:screenId", location.pathname);
    if (designMatch?.params.screenId) {
      const screenId = designMatch.params.screenId;
      const tabId = makeTabId("design", screenId);
      const existing = getTabs().find((t) => t.id === tabId);
      if (existing) {
        setActiveTab(tabId);
      } else {
        loadProject().then((project) => {
          const screen = project.screens.find((s) => s.id === screenId);
          if (screen) {
            openTab({ id: tabId, type: "design", resourceId: screenId, label: screen.name });
          } else {
            fallbackToDashboard("画面", screenId);
          }
        }).catch((e) => {
          recordError({ source: "manual", message: "loadProject 失敗", stack: e instanceof Error ? e.stack : undefined });
          fallbackToDashboard("画面", screenId);
        });
      }
      return;
    }

    const tableMatch = matchPath("/w/:wsId/table/edit/:tableId", location.pathname);
    if (tableMatch?.params.tableId) {
      const tableId = tableMatch.params.tableId;
      const tabId = makeTabId("table", tableId);
      const existing = getTabs().find((t) => t.id === tabId);
      if (existing) {
        setActiveTab(tabId);
      } else {
        loadTable(tableId).then((table) => {
          if (table) {
            openTab({ id: tabId, type: "table", resourceId: tableId, label: table.name ?? table.physicalName });
          } else {
            fallbackToDashboard("テーブル", tableId);
          }
        }).catch((e) => {
          recordError({ source: "manual", message: "loadTable 失敗", stack: e instanceof Error ? e.stack : undefined });
          fallbackToDashboard("テーブル", tableId);
        });
      }
      return;
    }

    const actionMatch = matchPath("/w/:wsId/process-flow/edit/:processFlowId", location.pathname);
    if (actionMatch?.params.processFlowId) {
      const processFlowId = actionMatch.params.processFlowId;
      const tabId = makeTabId("process-flow", processFlowId);
      const existing = getTabs().find((t) => t.id === tabId);
      if (existing) {
        setActiveTab(tabId);
      } else {
        loadProcessFlow(processFlowId).then((ag) => {
          if (ag) {
            openTab({ id: tabId, type: "process-flow", resourceId: processFlowId, label: ag.name });
          } else {
            fallbackToDashboard("処理フロー", processFlowId);
          }
        }).catch((e) => {
          recordError({ source: "manual", message: "loadProcessFlow 失敗", stack: e instanceof Error ? e.stack : undefined });
          fallbackToDashboard("処理フロー", processFlowId);
        });
      }
      return;
    }

    const sequenceMatch = matchPath("/w/:wsId/sequence/edit/:sequenceId", location.pathname);
    if (sequenceMatch?.params.sequenceId) {
      const sequenceId = sequenceMatch.params.sequenceId;
      const tabId = makeTabId("sequence", sequenceId);
      const existing = getTabs().find((t) => t.id === tabId);
      if (existing) {
        setActiveTab(tabId);
      } else {
        loadSequence(sequenceId).then((seq) => {
          if (seq) {
            openTab({ id: tabId, type: "sequence", resourceId: sequenceId, label: seq.id });
          } else {
            fallbackToDashboard("シーケンス", sequenceId);
          }
        }).catch((e) => {
          recordError({ source: "manual", message: "loadSequence 失敗", stack: e instanceof Error ? e.stack : undefined });
          fallbackToDashboard("シーケンス", sequenceId);
        });
      }
      return;
    }

    const viewMatch = matchPath("/w/:wsId/view/edit/:viewId", location.pathname);
    if (viewMatch?.params.viewId) {
      const viewId = viewMatch.params.viewId;
      const tabId = makeTabId("view", viewId);
      const existing = getTabs().find((t) => t.id === tabId);
      if (existing) {
        setActiveTab(tabId);
      } else {
        loadView(viewId).then((v) => {
          if (v) {
            openTab({ id: tabId, type: "view", resourceId: viewId, label: v.id });
          } else {
            fallbackToDashboard("ビュー", viewId);
          }
        }).catch((e) => {
          recordError({ source: "manual", message: "loadView 失敗", stack: e instanceof Error ? e.stack : undefined });
          fallbackToDashboard("ビュー", viewId);
        });
      }
      return;
    }

    const viewDefinitionMatch = matchPath("/w/:wsId/view-definition/edit/:viewDefinitionId", location.pathname);
    if (viewDefinitionMatch?.params.viewDefinitionId) {
      const viewDefinitionId = decodeURIComponent(viewDefinitionMatch.params.viewDefinitionId);
      const tabId = makeTabId("view-definition", viewDefinitionId);
      const existing = getTabs().find((t) => t.id === tabId);
      if (existing) {
        setActiveTab(tabId);
      } else {
        loadViewDefinition(viewDefinitionId).then((vd) => {
          if (vd) {
            openTab({ id: tabId, type: "view-definition", resourceId: viewDefinitionId, label: vd.name });
          } else {
            fallbackToDashboard("ビュー定義", viewDefinitionId);
          }
        }).catch((e) => {
          recordError({ source: "manual", message: "loadViewDefinition 失敗", stack: e instanceof Error ? e.stack : undefined });
          fallbackToDashboard("ビュー定義", viewDefinitionId);
        });
      }
      return;
    }

    const screenItemsMatch = matchPath("/w/:wsId/screen/items/:screenId", location.pathname);
    if (screenItemsMatch?.params.screenId) {
      const screenId = screenItemsMatch.params.screenId;
      const tabId = makeTabId("screen-items", screenId);
      const existing = getTabs().find((t) => t.id === tabId);
      if (existing) {
        setActiveTab(tabId);
      } else {
        loadProject().then((project) => {
          const screen = project.screens.find((s) => s.id === screenId);
          if (screen) {
            openTab({ id: tabId, type: "screen-items", resourceId: screenId, label: `${screen.name} (項目定義)` });
          } else {
            fallbackToDashboard("画面", screenId);
          }
        }).catch((e) => {
          recordError({ source: "manual", message: "loadProject 失敗 (screen-items)", stack: e instanceof Error ? e.stack : undefined });
          fallbackToDashboard("画面", screenId);
        });
      }
      return;
    }

    // /workspace/select はタブ対象外 (フルスクリーン選択画面)
    if (location.pathname === "/workspace/select") return;

    // シングルトンタブ: list / workspace 系は resourceId="main" で 1 インスタンスのみ
    // /w/:wsId/* 規約のパスと /workspace/list (wsId なし) を含む
    const wsPrefix = wsId ? `/w/${wsId}` : "";
    const singletonRoutes: ReadonlyArray<{ path: string; type: TabType; label: string }> = [
      { path: `${wsPrefix}/`,                   type: "dashboard",          label: "ダッシュボード" },
      { path: `${wsPrefix}/screen/flow`,        type: "screen-flow",        label: "画面フロー" },
      { path: `${wsPrefix}/screen/list`,        type: "screen-list",        label: "画面一覧" },
      { path: `${wsPrefix}/table/list`,         type: "table-list",         label: "テーブル一覧" },
      { path: `${wsPrefix}/table/er`,           type: "er",                 label: "ER図" },
      { path: `${wsPrefix}/process-flow/list`,  type: "process-flow-list",  label: "処理フロー一覧" },
      { path: `${wsPrefix}/extensions`,         type: "extensions",         label: "拡張管理" },
      { path: `${wsPrefix}/conventions/catalog`, type: "conventions-catalog", label: "規約カタログ" },
      { path: `${wsPrefix}/sequence/list`,      type: "sequence-list",      label: "シーケンス一覧" },
      { path: `${wsPrefix}/view/list`,          type: "view-list",           label: "ビュー一覧" },
      { path: `${wsPrefix}/view-definition/list`, type: "view-definition-list", label: "ビュー定義一覧" },
      { path: "/workspace/list",     type: "workspace-list",     label: "ワークスペース" },
    ];
    for (const { path, type, label } of singletonRoutes) {
      if (location.pathname === path) {
        const tabId = makeTabId(type, "main");
        const existing = getTabs().find((t) => t.id === tabId);
        if (existing) setActiveTab(tabId);
        else openTab({ id: tabId, type, resourceId: "main", label });
        return;
      }
    }
  }, [location.pathname]);

  // アクティブタブ → URL 同期
  // workspace 未選択中 (active=null) や /workspace/select 表示中は同期を停止する。
  // localStorage に残った activeTabId が design:xxx 等を指していると、guard が
  // /workspace/select に redirect → 直後に本 effect が /screen/design/xxx へ navigate
  // を上書き → guard が再度 redirect、というループ / flicker を起こすため。
  // workspace-list タブだけは select 画面からの誘導でも進入可能なので例外扱い。
  const activeTab = tabs.find((t) => t.id === activeTabId);
  // 前回 sync 済 activeTabId を ref で保持。本当に activeTabId が変化した時だけ navigate する
  // (StrictMode の二重 effect 実行 + workspaceState/ wsId などの spurious dep 変化に依る race を抑止)
  const lastSyncedActiveTabIdRef = useRef<string>(activeTabId);
  useEffect(() => {
    if (!activeTab) return;
    if (location.pathname === "/workspace/select") return;
    if (workspaceState.active === null && !workspaceState.lockdown && activeTab.type !== "workspace-list") {
      return;
    }
    // activeTabId が前回 sync 済の値と同じなら何もしない
    if (lastSyncedActiveTabIdRef.current === activeTabId) {
      return;
    }
    lastSyncedActiveTabIdRef.current = activeTabId;
    // /w/:wsId/* 規約のパスを生成。workspace-list は wsId なし
    const wp = wsId ? `/w/${wsId}` : "";
    const expectedPath =
      activeTab.type === "design"             ? `${wp}/screen/design/${activeTab.resourceId}`
      : activeTab.type === "table"            ? `${wp}/table/edit/${activeTab.resourceId}`
      : activeTab.type === "action"           ? `${wp}/process-flow/edit/${activeTab.resourceId}`
      : activeTab.type === "sequence"         ? `${wp}/sequence/edit/${activeTab.resourceId}`
      : activeTab.type === "view"             ? `${wp}/view/edit/${activeTab.resourceId}`
      : activeTab.type === "view-definition"  ? `${wp}/view-definition/edit/${activeTab.resourceId}`
      : activeTab.type === "screen-flow"      ? `${wp}/screen/flow`
      : activeTab.type === "screen-list"      ? `${wp}/screen/list`
      : activeTab.type === "table-list"       ? `${wp}/table/list`
      : activeTab.type === "er"               ? `${wp}/table/er`
      : activeTab.type === "process-flow-list" ? `${wp}/process-flow/list`
      : activeTab.type === "extensions"       ? `${wp}/extensions`
      : activeTab.type === "conventions-catalog" ? `${wp}/conventions/catalog`
      : activeTab.type === "screen-items"     ? `${wp}/screen/items/${activeTab.resourceId}`
      : activeTab.type === "sequence-list"    ? `${wp}/sequence/list`
      : activeTab.type === "view-list"              ? `${wp}/view/list`
      : activeTab.type === "view-definition-list"   ? `${wp}/view-definition/list`
      : activeTab.type === "workspace-list"         ? "/workspace/list"
      : activeTab.type === "dashboard"              ? `${wp}/`
      : null;
    if (expectedPath && location.pathname !== expectedPath) {
      uiInfo("tabsync", "active-tab → URL", { from: location.pathname, to: expectedPath, tabType: activeTab.type, tabId: activeTab.id });
      const guard = checkRedirect(expectedPath);
      if (guard.allow) navigate(expectedPath, { replace: true });
    }
  // 意図的に deps を [activeTabId] のみに絞っている。activeTab / workspaceState
  // / location.pathname / wsId / navigate を deps に含めると、URL→tab effect と
  // 競合してリダイレクトループを起こす (本 effect の役割は「activeTab 変更を URL に
  // 追随させる」だけで、それ以外の変化は URL→tab 側で吸収する設計)。
  // 将来 deps 追加が必要になったら、必ず lastSyncedActiveTabIdRef による
  // 「実際に activeTabId が変化した時だけ navigate」の不変条件を維持すること。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  const designTabs = tabs.filter((t) => t.type === "design");
  const activeIsDesign = activeTab?.type === "design";

  const handleCloseCrashedTab = (tabId: string) => {
    closeTab(tabId, true);
  };

  // 初回ハイドレーション中はルートを描画しない (#676 review):
  // workspaceState.loading=true の間に dashboard / 一覧系を描画すると、singleton stores
  // (flowStore / tableStore 等) が WS 未接続のうちに localStorage fallback で初期化されて
  // 旧 workspace のデータをキャッシュしてしまう。そのキャッシュは hydration 後も残り続け、
  // その状態から保存すると active workspace に旧データが上書きされる。
  // loading=false (= 初回 load 成功 or 失敗 or lockdown 確定) になるまで splash で遅延させる。
  if (workspaceState.loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: "8px",
        color: "var(--muted-text, #888)",
      }}>
        <i className="bi bi-hourglass-split" style={{ fontSize: "1.5rem" }} />
        <p style={{ margin: 0 }}>ワークスペース情報を読み込み中...</p>
      </div>
    );
  }

  return (
    <>
      <CommonHeader />
      <TabBar />

      {/* デザインタブ: 全て常時マウント、非アクティブは display:none */}
      {designTabs.map((tab) => (
        <div
          key={tab.id}
          style={{ display: activeTabId === tab.id ? "block" : "none", height: "calc(100vh - var(--common-header-h, 0px) - var(--tabbar-h, 0px))" }}
        >
          <ErrorBoundary
            context={{ tabId: tab.id, type: tab.type, resourceId: tab.resourceId }}
            fallback={(error, reset) => (
              <TabErrorFallback
                error={error}
                tabLabel={tab.label}
                onRetry={reset}
                onClose={() => handleCloseCrashedTab(tab.id)}
              />
            )}
          >
            <Designer
              screenId={tab.resourceId}
              screenName={tab.label}
              isActive={activeTabId === tab.id}
            />
          </ErrorBoundary>
        </div>
      ))}

      {/* 非デザインコンテンツ: 子 Route の element を <Outlet /> でレンダ。
          子 Route は外側 AppShell の <Route path="/w/:wsId"> の children として
          宣言されている。 */}
      {!activeIsDesign && (
        <ErrorBoundary
          resetKey={activeTabId}
          context={{ tabId: activeTabId, type: activeTab?.type, pathname: location.pathname }}
          fallback={(error, reset) => (
            <TabErrorFallback
              error={error}
              tabLabel={activeTab?.label ?? "コンテンツ"}
              onRetry={reset}
              onClose={() => {
                if (activeTabId) handleCloseCrashedTab(activeTabId);
              }}
            />
          )}
        >
          <Outlet />
        </ErrorBoundary>
      )}
    </>
  );
}
