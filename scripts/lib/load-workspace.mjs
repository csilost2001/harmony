/**
 * ワークスペース (harmony.json + dataDir 配下の JSON) を読み、設計書の入力 (DesignDocInput) に組み立てる。
 * export-design-doc.mjs (HTML 出力) と check-design.mjs (要確認事項の検査) が共有する。
 */
import fs from "node:fs";
import path from "node:path";

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
/** ファイルが無ければ null、あるのに読めない (JSON が壊れている) ときは例外 */
const readJsonStrict = (p) => {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

/**
 * @param {string} dir ワークスペースのルート (harmony.json のあるディレクトリ)
 * @param {(msg: string) => void} warn 警告の出力先 (問題は `problems` にも入る)
 * @returns {{ input: object, counts: object, dataDir: string, problems: Array<{severity: string, section: string, message: string}> } | null} harmony.json が読めなければ null
 *   problems: 設計書に載せられなかったもの (壊れた JSON は error、harmony.json に登録されていないファイルは warning)
 */
export function loadWorkspaceInput(dir, warn = console.warn) {
  const problems = [];
  const report = (severity, message) => { problems.push({ severity, section: "読み込み", message }); warn(`警告: ${message}`); };
  // 読めない (壊れた) ファイルは黙って捨てず、問題として返し、設計書に載らないことを伝える
  const listJson = (d, filter = () => true) =>
    fs.existsSync(d)
      ? fs.readdirSync(d).filter((f) => f.endsWith(".json") && filter(f)).sort().flatMap((f) => {
          const data = readJson(path.join(d, f));
          if (data === null) report("error", `${path.join(path.basename(d), f)} を読めない (JSON が壊れている) ため設計書に含めません`);
          return data === null ? [] : [data];
        })
      : [];
  /** 1 つのファイル (規約カタログなど)。無ければ null (問題にしない)、壊れていれば問題にして null */
  const readOptional = (p, label) => {
    try { return readJsonStrict(p); } catch { report("error", `${label} を読めない (JSON が壊れている) ため設計書に含めません`); return null; }
  };

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
    for (const u of all.filter((x) => !ids.includes(idOf(x)))) report("warning", `${label}「${idOf(u)}」は harmony.json に登録されていないため設計書に含めません (検査もされません)`);
    return ids.map((id) => all.find((x) => idOf(x) === id)).filter(Boolean);
  };
  const flows = pickRegistered(listJson(path.join(dataDir, "process-flows")), harmony.entities?.processFlows, "処理フロー", (f) => f.meta?.id);
  const tables = pickRegistered(listJson(path.join(dataDir, "tables")), harmony.entities?.tables, "テーブル", (t) => t.id);
  const conventions = readOptional(path.join(dataDir, "conventions", "catalog.json"), "conventions/catalog.json");
  const layoutComponents = readOptional(path.join(dataDir, "layout-components.json"), "layout-components.json")?.components ?? [];
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
    limits: conventions?.limit ?? {},
    regex: conventions?.regex ?? {},
  };
  return { input, dataDir, problems, counts: { screens: screens.length, flows: flows.length, tables: tables.length, businessFlows: businessFlows.length, reports: reports.length } };
}
