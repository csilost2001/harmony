/**
 * 最近編集したものパネル
 *
 * サーバー側ファイルの mtime を取得し、画面 / テーブル / 処理フローを
 * 横断した更新日時降順リストを表示。クリックで該当エディタを開く。
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadProject } from "../../../store/flowStore";
import { listTables } from "../../../store/tableStore";
import { fetchServerMtime, type MtimeKind } from "../../../utils/serverMtime";
import { mcpBridge } from "../../../mcp/mcpBridge";

const MAX_ITEMS = 10;

interface RecentItem {
  kind: "screen" | "table" | "processFlow";
  id: string;
  name: string;
  mtime: number;
  route: string;
}

const KIND_META: Record<RecentItem["kind"], { label: string; icon: string; color: string; route: (id: string) => string }> = {
  screen: { label: "画面", icon: "bi-window", color: "#6366f1", route: (id) => `/screen/design/${id}` },
  table: { label: "テーブル", icon: "bi-table", color: "#0284c7", route: (id) => `/table/edit/${id}` },
  processFlow: { label: "処理フロー", icon: "bi-lightning-charge", color: "#f59e0b", route: (id) => `/process-flow/edit/${id}` },
};

function formatRelative(mtime: number, now: number): string {
  const diff = now - mtime;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 時間前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 日前`;
  return new Date(mtime).toLocaleDateString();
}

async function fetchAll(): Promise<RecentItem[]> {
  const [project, tables] = await Promise.all([loadProject(), listTables()]);

  const resources: Array<{ kind: MtimeKind; id: string; name: string; displayKind: RecentItem["kind"] }> = [
    ...project.screens.map((s) => ({ kind: "screen" as MtimeKind, id: s.id, name: s.name, displayKind: "screen" as RecentItem["kind"] })),
    ...tables.map((t) => ({ kind: "table" as MtimeKind, id: t.id, name: t.name ?? t.physicalName ?? t.id, displayKind: "table" as RecentItem["kind"] })),
    ...(project.processFlows ?? []).map((a) => ({ kind: "processFlow" as MtimeKind, id: a.id, name: a.name, displayKind: "processFlow" as RecentItem["kind"] })),
  ];

  const withMtime = await Promise.all(
    resources.map(async (r) => {
      const mtime = await fetchServerMtime(r.kind, r.id);
      if (mtime === null) return null;
      return {
        kind: r.displayKind,
        id: r.id,
        name: r.name,
        mtime,
        route: KIND_META[r.displayKind].route(r.id),
      } satisfies RecentItem;
    }),
  );

  return withMtime
    .filter((x): x is RecentItem => x !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_ITEMS);
}

export function RecentEditsPanel() {
  const navigate = useNavigate();
  const [items, setItems] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      const list = await fetchAll();
      setItems(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const unsubProject = mcpBridge.onBroadcast("projectChanged", reload);
    const unsubScreen = mcpBridge.onBroadcast("screenChanged", reload);
    const unsubTable = mcpBridge.onBroadcast("tableChanged", reload);
    const unsubAction = mcpBridge.onBroadcast("processFlowChanged", reload);
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      if (s === "connected") reload();
    });
    // 相対時間を 30 秒毎に更新
    const tid = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      unsubProject();
      unsubScreen();
      unsubTable();
      unsubAction();
      unsubStatus();
      clearInterval(tid);
    };
  }, [reload]);

  if (error) {
    return <div className="panel-error"><i className="bi bi-exclamation-triangle" /> 取得失敗: {error}</div>;
  }

  if (loading) {
    return <div className="recent-loading"><i className="bi bi-hourglass" /> 読み込み中...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="recent-empty">
        <i className="bi bi-inbox" />
        <span>編集履歴がまだありません</span>
      </div>
    );
  }

  return (
    <ul className="recent-list">
      {items.map((it) => {
        const meta = KIND_META[it.kind];
        return (
          <li
            key={`${it.kind}:${it.id}`}
            className="recent-row"
            onClick={() => navigate(it.route)}
            title={`${meta.label}: ${it.name}`}
          >
            <i className={`bi ${meta.icon} recent-icon`} style={{ color: meta.color }} />
            <div className="recent-body">
              <div className="recent-name">{it.name}</div>
              <div className="recent-meta">
                <span className="recent-kind">{meta.label}</span>
                <span className="recent-time">{formatRelative(it.mtime, now)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
