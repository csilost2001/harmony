/**
 * ワークスペース (harmony.json + dataDir 配下の JSON) を読み、設計書の入力 (DesignDocInput) に組み立てる。
 * export-design-doc.mjs (HTML 出力) と check-design.mjs (要確認事項の検査) が共有する。
 */
import fs from "node:fs";
import path from "node:path";
import { parseCheckSettings, summarizeOpenApi } from "@harmony/shared";

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
  // 処理フロー・テーブルは、harmony.json の一覧の順に並べ、一覧に載っていないファイルも後ろに含める (ファイルが原本。
  // アプリの設計書ビューと同じ)。載っていないものは、一覧に載せるよう知らせるだけ (情報)。
  const pickRegistered = (all, registry, label, idOf) => {
    if (!Array.isArray(registry)) return all;
    const ids = registry.map((e) => e.id);
    const registered = ids.map((id) => all.find((x) => idOf(x) === id)).filter(Boolean);
    const extra = all.filter((x) => !ids.includes(idOf(x))).sort((a, b) => String(idOf(a)).localeCompare(String(idOf(b))));
    for (const u of extra) problems.push({ severity: "info", section: "読み込み", message: `${label}「${idOf(u)}」は harmony.json の一覧に載っていません (設計書・検査には含めました。アプリで保存すると一覧に載ります)` });
    return [...registered, ...extra];
  };
  const flows = pickRegistered(listJson(path.join(dataDir, "process-flows")), harmony.entities?.processFlows, "処理フロー", (f) => f.meta?.id);
  const tables = pickRegistered(listJson(path.join(dataDir, "tables")), harmony.entities?.tables, "テーブル", (t) => t.id);
  const conventions = readOptional(path.join(dataDir, "conventions", "catalog.json"), "conventions/catalog.json");
  const layoutComponents = readOptional(path.join(dataDir, "layout-components.json"), "layout-components.json")?.components ?? [];
  const businessFlows = listJson(path.join(dataDir, "business-flows"));
  const reports = listJson(path.join(dataDir, "reports"));

  // 汎用定義 (種類と名前つき。未使用の検出・影響分析が参照の走査に使う)
  const genericDefinitions = [];
  const genRoot = path.join(dataDir, "generic-definitions");
  if (fs.existsSync(genRoot)) {
    for (const kind of fs.readdirSync(genRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort()) {
      for (const g of listJson(path.join(genRoot, kind))) genericDefinitions.push({ ...g, kind });
    }
  }
  // 点検の設定 (抑制・独自ルール)。読めない項目は捨てて、問題として知らせる
  const checkFile = path.join(dataDir, "design-check.json");
  let checkSettings;
  if (fs.existsSync(checkFile)) {
    try {
      const parsed = parseCheckSettings(JSON.parse(fs.readFileSync(checkFile, "utf8")));
      checkSettings = parsed.settings;
      for (const m of parsed.problems) problems.push({ severity: "warning", section: "読み込み", message: `design-check.json: ${m}` });
    } catch { report("error", "design-check.json を読めない (JSON が壊れている) ため、抑制・独自ルールを適用しません"); }
  }
  // 外部システムの OpenAPI の定義 (ワークスペース内の JSON だけ。URL は取りに行かない)
  const externalSpecs = Object.create(null); // キーは設計の値。`__proto__` で Object.prototype を触らない
  for (const f of flows) {
    for (const e of Object.values(f.context?.catalogs?.externalSystems ?? {})) {
      const src = typeof e?.openApiSpec === "string" ? e.openApiSpec.trim() : "";
      if (!src || Object.hasOwn(externalSpecs, src)) continue;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) { externalSpecs[src] = { source: src, skipped: "url", operations: [] }; continue; }
      const root = path.resolve(dir);
      let real = null;
      try {
        const base = fs.realpathSync(root);
        for (const c of [path.resolve(dir, src), path.resolve(dataDir, src)]) {
          if (c !== root && !c.startsWith(root + path.sep)) continue; // 文字列として外を指す
          if (!fs.existsSync(c)) continue;
          const r = fs.realpathSync(c); // リンクをたどった先も、ワークスペースの中でなければ読まない
          if (r === base || r.startsWith(base + path.sep)) { real = r; break; }
        }
      } catch { real = null; }
      if (!real) { externalSpecs[src] = { source: src, error: "ファイルが見つかりません (ワークスペースの外は読みません)", operations: [] }; continue; }
      if (!/\.json$/i.test(real)) { externalSpecs[src] = { source: src, error: "JSON 形式の OpenAPI だけ読めます (YAML は照合していません)", operations: [] }; continue; }
      try {
        const st = fs.statSync(real);
        if (!st.isFile() || st.size > 5 * 1024 * 1024) { externalSpecs[src] = { source: src, error: st.isFile() ? "ファイルが大きすぎます (5 MB まで)" : "通常のファイルではありません", operations: [] }; continue; }
        externalSpecs[src] = summarizeOpenApi(src, JSON.parse(fs.readFileSync(real, "utf8")));
      } catch { externalSpecs[src] = { source: src, error: "JSON として読めません", operations: [] }; }
    }
  }

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
    db: conventions?.db ?? {},
    genericDefinitions,
    ...(checkSettings ? { checkSettings } : {}),
    ...(Object.keys(externalSpecs).length ? { externalSpecs: { ...externalSpecs } } : {}),
  };
  return { input, dataDir, problems, counts: { screens: screens.length, flows: flows.length, tables: tables.length, businessFlows: businessFlows.length, reports: reports.length } };
}
