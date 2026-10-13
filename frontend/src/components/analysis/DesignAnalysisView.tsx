/**
 * 設計の分析。設計の品質を、機械が助ける画面: 要確認の管理 (抑制)・影響分析・対応表 (トレーサビリティほか)・整理 (未使用・用語・メッセージ)・
 * 運用 (SLA・ジョブ・外部システム)・進捗・ルール (命名規約・独自の検査)・書き出し (テスト雛形・テストデータ・OpenAPI)。
 * 計算は @harmony/shared の関数で、設計書・check:design・MCP と同じ結果になる。この画面は、設計を書き換えない (点検の設定 design-check.json だけ書く)。
 */
import { useState } from "react";
import { useAnalysisData } from "./useAnalysisData";
import { IssuesTab } from "./tabs/IssuesTab";
import { ImpactTab } from "./tabs/ImpactTab";
import { MapsTab } from "./tabs/MapsTab";
import { CleanupTab } from "./tabs/CleanupTab";
import { OpsTab } from "./tabs/OpsTab";
import { ProgressTab } from "./tabs/ProgressTab";
import { RulesTab } from "./tabs/RulesTab";
import { ExportTab } from "./tabs/ExportTab";
import "../../styles/analysis.css";

type TabId = "issues" | "impact" | "maps" | "cleanup" | "ops" | "progress" | "rules" | "export";
const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "issues", label: "要確認", icon: "bi-clipboard2-check" },
  { id: "impact", label: "影響分析", icon: "bi-diagram-3" },
  { id: "maps", label: "対応表", icon: "bi-table" },
  { id: "cleanup", label: "整理", icon: "bi-trash3" },
  { id: "ops", label: "運用", icon: "bi-speedometer" },
  { id: "progress", label: "進捗", icon: "bi-bar-chart-steps" },
  { id: "rules", label: "ルール", icon: "bi-rulers" },
  { id: "export", label: "書き出し", icon: "bi-box-arrow-up" },
];
const KEY = "harmony.analysis.tab";

function initialTab(): TabId {
  try { const v = localStorage.getItem(KEY); return TABS.some((t) => t.id === v) ? (v as TabId) : "issues"; } catch { return "issues"; }
}

export function DesignAnalysisView() {
  const data = useAnalysisData();
  const [tab, setTab] = useState<TabId>(initialTab);
  const choose = (t: TabId) => { setTab(t); try { localStorage.setItem(KEY, t); } catch { /* 保存できなくても、画面は動く */ } };
  const { input, settings } = data;

  return (
    <div className="an-root" data-testid="design-analysis-view">
      <header className="an-toolbar">
        <h1 className="an-title"><i className="bi bi-search-heart" /> 設計の分析</h1>
        <span className="an-sub">設計の抜け・矛盾・影響・進み具合を、機械が調べます。設計は書き換えません。</span>
        <span className="an-spacer" />
        <button type="button" className="an-btn" onClick={data.reload} disabled={data.loading}><i className="bi bi-arrow-clockwise" /> 読み直す</button>
      </header>
      <nav className="an-tabs" role="tablist" aria-label="分析の種類">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => choose(t.id)} data-testid={`an-tab-${t.id}`}>
            <i className={`bi ${t.icon}`} /> {t.label}
          </button>
        ))}
      </nav>
      <div className="an-body" role="tabpanel">
        {data.error ? <div className="an-message" role="alert">設計データを読み込めませんでした: {data.error}</div>
          : !input || !settings ? <div className="an-message">設計を読み込んでいます…</div>
            : tab === "issues" ? <IssuesTab input={input} skipped={data.skipped} reload={data.reload} />
              : tab === "impact" ? <ImpactTab input={input} />
                : tab === "maps" ? <MapsTab input={input} />
                  : tab === "cleanup" ? <CleanupTab input={input} />
                    : tab === "ops" ? <OpsTab input={input} />
                      : tab === "progress" ? <ProgressTab input={input} />
                        : tab === "rules" ? <RulesTab key={JSON.stringify(settings.rules)} input={input} settings={settings} problems={data.settingsProblems} reload={data.reload} />
                          : <ExportTab input={input} />}
      </div>
    </div>
  );
}
