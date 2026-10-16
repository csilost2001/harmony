/**
 * 連携と運用。外へつなぐ・配る・チームで使う機能を 1 か所にまとめた画面: レビューと承認・変更の記録・Git・通知・生成の管理・取り込み・利用者と権限・版と更新。
 * 設計の原本は、取り込み (新規作成のみ) と、各設定の保存以外では書き換えない。仕様: docs/spec/integration-ops.md
 */
import { useEffect, useState } from "react";
import { ReviewTab } from "./tabs/ReviewTab";
import { AuditTab } from "./tabs/AuditTab";
import { GitTab } from "./tabs/GitTab";
import { NotifyTab } from "./tabs/NotifyTab";
import { GenerationTab } from "./tabs/GenerationTab";
import { ImportTab } from "./tabs/ImportTab";
import { AccessTab } from "./tabs/AccessTab";
import { VersionTab } from "./tabs/VersionTab";
import "../../styles/analysis.css";
import "../../styles/operations.css";

export type OpsTabId = "review" | "audit" | "git" | "notify" | "generation" | "import" | "access" | "version";
const TABS: Array<{ id: OpsTabId; label: string; icon: string }> = [
  { id: "review", label: "レビューと承認", icon: "bi-patch-check" },
  { id: "audit", label: "変更の記録", icon: "bi-clock-history" },
  { id: "git", label: "Git", icon: "bi-git" },
  { id: "notify", label: "通知", icon: "bi-bell" },
  { id: "generation", label: "生成の管理", icon: "bi-cpu" },
  { id: "import", label: "取り込み", icon: "bi-box-arrow-in-down" },
  { id: "access", label: "利用者と権限", icon: "bi-people" },
  { id: "version", label: "版と更新", icon: "bi-info-circle" },
];
const KEY = "harmony.operations.tab";

function initialTab(): OpsTabId {
  try { const v = localStorage.getItem(KEY); return TABS.some((t) => t.id === v) ? (v as OpsTabId) : "review"; } catch { return "review"; }
}

export function OperationsView() {
  const [tab, setTab] = useState<OpsTabId>(initialTab);
  // ファイルのドロップ (FileDropImport) から、取り込みを開かれたとき
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (TABS.some((x) => x.id === t)) setTab(t as OpsTabId); };
    window.addEventListener("harmony:ops-tab", on);
    return () => window.removeEventListener("harmony:ops-tab", on);
  }, []);
  const choose = (t: OpsTabId) => { setTab(t); try { localStorage.setItem(KEY, t); } catch { /* 保存できなくても、画面は動く */ } };
  return (
    <div className="an-root" data-testid="operations-view">
      <header className="an-toolbar">
        <h1 className="an-title"><i className="bi bi-diagram-2" /> 連携と運用</h1>
        <span className="an-sub">レビュー・承認・Git・通知・取り込み・権限など、チームで使う・外へつなぐための機能です。</span>
      </header>
      <nav className="an-tabs" role="tablist" aria-label="連携と運用の種類">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => choose(t.id)} data-testid={`op-tab-${t.id}`}>
            <i className={`bi ${t.icon}`} /> {t.label}
          </button>
        ))}
      </nav>
      <div className="an-body" role="tabpanel">
        {tab === "review" ? <ReviewTab /> : tab === "audit" ? <AuditTab /> : tab === "git" ? <GitTab /> : tab === "notify" ? <NotifyTab />
          : tab === "generation" ? <GenerationTab /> : tab === "import" ? <ImportTab /> : tab === "access" ? <AccessTab /> : <VersionTab />}
      </div>
    </div>
  );
}
