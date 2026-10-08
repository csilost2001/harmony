/**
 * 帳票の MCP tool handler。
 *
 * - designer__list_reports   一覧 (id / 名前 / 出力形式 / 部数 / 項目数 / 要確認の件数)
 * - designer__get_report     1 件の原本 + 検証結果
 * - designer__save_report    1 件の保存 (構造以外の問題は保存を妨げず、検証結果を返す)
 * - designer__delete_report  1 件の削除
 *
 * 仕様: docs/spec/report.md
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { validateReport, type Report } from "@harmony/shared";
import { readReport, listReports, writeReport, deleteReport, listExistingEntityIds, listAllTables } from "../projectStorage.js";
import { wsBridge } from "../wsBridge.js";
import { workspaceContextManager } from "../workspaceState.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 検証に使う参照先 (画面 / 処理フロー / テーブルと列)。読めないものは確認しない */
export async function reportRefs(root: string) {
  const screens = await listExistingEntityIds("screen", root).then((ids) => new Set(ids)).catch(() => undefined);
  const flows = await listExistingEntityIds("processFlow", root).then((ids) => new Set(ids)).catch(() => undefined);
  const tables = await listAllTables(root).then((all) => new Map(all.filter(isRecord).map((t) => [
    String(t.id), new Set((Array.isArray(t.columns) ? t.columns : []).filter(isRecord).map((c) => String(c.physicalName))),
  ] as const))).catch(() => undefined);
  return { screens, flows, tables };
}

export const handleReportTool: ToolHandler = async (name, args, root, sessionId) => {
  const a = args ?? {};
  const wsId = () => workspaceContextManager.getActivePath(sessionId);

  switch (name) {
    case "designer__list_reports": {
      const refs = await reportRefs(root);
      const reports = (await listReports(root)) as unknown as Report[];
      return json({
        reports: reports.map((r) => ({
          id: r.id, name: r.name, maturity: r.maturity, format: r.output?.format ?? "pdf",
          sections: r.sections?.length ?? 0, fields: (r.sections ?? []).reduce((n, s) => n + (s.fields?.length ?? 0), 0),
          issues: validateReport(r, refs).filter((i) => i.severity !== "info").length,
        })),
      });
    }

    case "designer__get_report": {
      assertEntityIdMcp(a.reportId, "reportId");
      const report = await readReport(a.reportId, root);
      if (!report) throw new McpError(ErrorCode.InvalidParams, `帳票「${a.reportId}」が見つかりません`);
      return json({ report, issues: validateReport(report as unknown as Report, await reportRefs(root)) });
    }

    case "designer__save_report": {
      assertEntityIdMcp(a.reportId, "reportId");
      if (!isRecord(a.report) || !Array.isArray(a.report.sections) || typeof a.report.name !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "report は { name, sections: [] } の形で指定してください");
      }
      const saved = await writeReport(a.reportId, { ...a.report, id: a.reportId }, root);
      wsBridge.broadcast({ wsId: wsId(), event: "reportChanged", data: { reportId: a.reportId } });
      const issues = validateReport(saved as unknown as Report, await reportRefs(root));
      const counts = { error: 0, warning: 0, info: 0 };
      for (const i of issues) counts[i.severity]++;
      return json({ saved: true, reportId: a.reportId, counts, issues: issues.filter((i) => i.severity !== "info") });
    }

    case "designer__delete_report": {
      assertEntityIdMcp(a.reportId, "reportId");
      const deleted = await deleteReport(a.reportId, root);
      if (deleted) wsBridge.broadcast({ wsId: wsId(), event: "reportChanged", data: { reportId: a.reportId, deleted: true } });
      return json({ deleted });
    }

    default:
      return null;
  }
};
