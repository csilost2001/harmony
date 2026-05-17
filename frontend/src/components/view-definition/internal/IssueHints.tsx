/**
 * ViewDefinitionEditor 共通 — issue 表示ヘルパー (Phase-4 抽出)
 *
 * 各セクションのフィールド直下に inline で issue を列挙する。
 */
import type { ViewDefinitionIssue } from "../../../schemas/viewDefinitionValidator";

export function IssueHints({ issues }: { issues: ViewDefinitionIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="vd-editor-issue-hints">
      {issues.map((iss, i) => (
        <small
          key={i}
          className={`vd-editor-issue vd-editor-issue--${iss.severity}`}
          title={iss.code}
        >
          <i className={`bi ${iss.severity === "error" ? "bi-x-circle-fill" : "bi-exclamation-triangle-fill"}`} />
          {" "}{iss.message}
        </small>
      ))}
    </div>
  );
}
