/**
 * 帳票 (reports/<id>.json) のストア。
 *
 * 一覧・編集画面・設計書ビューから共通に使う。保存は明示的 (編集画面の「保存」)。
 *
 * 仕様: docs/spec/report.md
 */
import { useCallback, useEffect, useState } from "react";
import type { Report } from "@harmony/shared";
import { mcpBridge } from "../mcp/mcpBridge";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** 一覧と、読めなかったファイル名 (JSON が壊れているもの) */
export async function listReportsDetailed(): Promise<{ reports: Report[]; unreadable: string[] }> {
  const res = (await mcpBridge.request("listReports")) as { reports?: Report[]; unreadable?: string[] } | null;
  return { reports: res?.reports ?? [], unreadable: res?.unreadable ?? [] };
}

export async function listReports(): Promise<Report[]> {
  return (await listReportsDetailed()).reports;
}

export async function loadReport(reportId: string): Promise<Report | null> {
  return ((await mcpBridge.request("loadReport", { reportId })) as Report | null) ?? null;
}

/** 開いたあとに他で更新されていて、保存を断られたときのエラーかどうか */
export const isSaveConflict = (e: unknown): boolean => e instanceof Error && e.message.includes("他で更新されています");

/** 保存する。既定では「開いたときの更新日時」と照合し、他で更新されていたら保存しない (force で上書き) */
export async function saveReport(report: Report, opts: { force?: boolean } = {}): Promise<Report> {
  const saved = (await mcpBridge.request("saveReport", { reportId: report.id, data: report, expectedUpdatedAt: opts.force ? undefined : report.updatedAt })) as Report;
  notify();
  return saved;
}

export async function deleteReport(reportId: string): Promise<void> {
  await mcpBridge.request("deleteReport", { reportId });
  notify();
}

/** 新しい帳票 (表題部と明細部だけを持つ) */
export function buildDefaultReport(id: string, name: string): Report {
  return {
    version: 1, id, name, maturity: "draft",
    output: { format: "pdf", paper: "A4", orientation: "portrait" },
    sections: [
      { id: "title", kind: "reportHeader", name: "表題", fields: [{ id: "titleText", kind: "text", label: name, align: "center", width: 100 }] },
      { id: "lines", kind: "detail", name: "明細", fields: [] },
    ],
  };
}

/** 帳票の一覧。保存・削除 (自分 / 他のブラウザ) のたびに読み直す */
export function useReports(): { reports: Report[]; unreadable: string[]; loaded: boolean; reload: () => Promise<void> } {
  const [reports, setReports] = useState<Report[]>([]);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      const res = await listReportsDetailed();
      setReports(res.reports);
      setUnreadable(res.unreadable);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    reload().catch(console.error);
    const onLocal = () => { reload().catch(console.error); };
    listeners.add(onLocal);
    const off = mcpBridge.onBroadcast("reportChanged", onLocal);
    return () => { listeners.delete(onLocal); off(); };
  }, [reload]);
  return { reports, unreadable, loaded, reload };
}
