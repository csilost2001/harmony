/**
 * ワークスペース (harmony.json + dataDir 配下の JSON) を読み、設計書の入力 (DesignDocInput) に組み立てる。
 * export-design-doc.mjs (HTML 出力) と check-design.mjs (要確認事項の検査) が共有する。
 */
import fs from "node:fs";
import path from "node:path";

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

/**
 * @param {string} dir ワークスペースのルート (harmony.json のあるディレクトリ)
 * @param {(msg: string) => void} warn 警告の出力先
 * @returns {{ input: object, counts: object, dataDir: string } | null} harmony.json が読めなければ null
 */
export function loadWorkspaceInput(dir, warn = console.warn) {
  // 読めない (壊れた) ファイルは黙って捨てず、警告を出して設計書に載らないことを伝える
  const listJson = (d, filter = () => true) =>
    fs.existsSync(d)
      ? fs.readdirSync(d).filter((f) => f.endsWith(".json") && filter(f)).sort().flatMap((f) => {
          const data = readJson(path.join(d, f));
          if (data === null) warn(`警告: ${path.join(path.basename(d), f)} を読めない (JSON が壊れている) ため設計書に含めません`);
          return data === null ? [] : [data];
        })
      : [];

  const harmony = readJson(path.join(dir, "harmony.json"));
  if (!harmony) return null;
  const dataDir = path.join(dir, harmony.dataDir ?? "harmony");

  // 画面は harmony.json の登録順に並べる
  const screensRaw = listJson(path.join(dataDir, "screens"), (f) => !f.includes(".design.") && !f.includes("puck"));
  const order = (harmony.entities?.screens ?? []).map((s) => s.id);
  const screens = [...screensRaw].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  // 処理フロー・テーブルは harmony.json に登録されたものを対象にする (アプリの設計書ビューと同じ)。
  // 登録されていないファイルは警告だけ出す。
  const pickRegistered = (all, registry, label, idOf) => {
    if (!Array.isArray(registry)) return all;
    const ids = registry.map((e) => e.id);
    for (const u of all.filter((x) => !ids.includes(idOf(x)))) warn(`警告: ${label}「${idOf(u)}」は harmony.json に登録されていないため設計書に含めません`);
    return ids.map((id) => all.find((x) => idOf(x) === id)).filter(Boolean);
  };
  const flows = pickRegistered(listJson(path.join(dataDir, "process-flows")), harmony.entities?.processFlows, "処理フロー", (f) => f.meta?.id);
  const tables = pickRegistered(listJson(path.join(dataDir, "tables")), harmony.entities?.tables, "テーブル", (t) => t.id);
  const conventions = readJson(path.join(dataDir, "conventions", "catalog.json"));
  const layoutComponents = readJson(path.join(dataDir, "layout-components.json"))?.components ?? [];
  const businessFlows = listJson(path.join(dataDir, "business-flows"));
  const reports = listJson(path.join(dataDir, "reports"));

  const input = {
    project: { name: harmony.meta?.name ?? path.basename(dir), description: harmony.meta?.description },
    screens,
    flows,
    tables,
    transitions: harmony.entities?.screenTransitions ?? [],
    messages: conventions?.msg ?? {},
    layoutComponents,
    businessFlows,
    reports,
    roles: conventions?.role ?? {},
    permissions: conventions?.permission ?? {},
  };
  return { input, dataDir, counts: { screens: screens.length, flows: flows.length, tables: tables.length, businessFlows: businessFlows.length, reports: reports.length } };
}
