/**
 * 書き出し。テスト観点からのテスト雛形、テーブルの定義に沿ったテストデータ、処理フローの HTTP の契約からの OpenAPI。
 * どれも設計を読んで作るだけで、設計は書き換えない。
 */
import { useMemo, useState } from "react";
import {
  buildDiagramText, businessFlowSvg, diagramFileStem, diagramTargets, DIAGRAM_FORMAT_LABELS, processFlowSvg, type DiagramFormat,
  buildOpenApi, deriveTestViewpointSheet, generateTestData, scaffoldTests, TEST_FRAMEWORK_LABELS, testDataTableToCsv, testDataToInsertSql,
  type DesignDocInput, type SqlQuote, type TestFramework,
} from "@harmony/shared";
import { AnTable, Empty, Section } from "../ui";
import { copyText, saveTextFile, withBom } from "../fileIo";

type Sub = "scaffold" | "data" | "openapi" | "diagram";
const SUBS: Array<{ id: Sub; label: string }> = [{ id: "scaffold", label: "テスト雛形" }, { id: "data", label: "テストデータ" }, { id: "openapi", label: "OpenAPI" }, { id: "diagram", label: "図 (Mermaid・PlantUML・SVG)" }];

export function ExportTab({ input }: { input: DesignDocInput }) {
  const [sub, setSub] = useState<Sub>("scaffold");
  return (
    <div className="an-pane" data-testid="an-export">
      <nav className="an-subtabs" aria-label="書き出しの種類">
        {SUBS.map((s) => <button key={s.id} type="button" className={sub === s.id ? "on" : ""} aria-pressed={sub === s.id} onClick={() => setSub(s.id)}>{s.label}</button>)}
      </nav>
      {sub === "scaffold" ? <Scaffold input={input} /> : sub === "data" ? <TestData input={input} /> : sub === "diagram" ? <Diagrams input={input} /> : <OpenApi input={input} />}
    </div>
  );
}

function Preview({ title, text, filename, mime, extra }: { title: string; text: string; filename: string; mime: string; extra?: string }) {
  return (
    <div className="an-preview" data-testid="an-preview">
      <div className="an-row"><b>{title}</b>{extra && <span className="an-hint">{extra}</span>}<span className="an-spacer" />
        <button type="button" className="an-btn" onClick={() => void copyText(text)}><i className="bi bi-clipboard" /> コピー</button>
        <button type="button" className="an-btn primary" onClick={() => saveTextFile(filename, mime === "text/csv" ? withBom(text) : text, mime)}><i className="bi bi-download" /> 保存</button>
      </div>
      <pre className="an-code"><code>{text}</code></pre>
    </div>
  );
}

function Scaffold({ input }: { input: DesignDocInput }) {
  const [framework, setFramework] = useState<TestFramework>("vitest");
  const [dir, setDir] = useState("tests");
  const [pickScreens, setPickScreens] = useState<string[]>([]);
  const [pickFlows, setPickFlows] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const pages = useMemo(() => input.screens.filter((s) => s.purpose !== "gadget"), [input]);
  const sheet = useMemo(() => {
    const full = deriveTestViewpointSheet({ screens: pages, flows: input.flows, limits: input.limits, regex: input.regex, messages: input.messages });
    // 何も選んでいなければ、すべて
    const keepAll = pickScreens.length === 0 && pickFlows.length === 0;
    return keepAll ? full : { ...full, screens: full.screens.filter((s) => pickScreens.includes(s.screenId)), flows: full.flows.filter((f) => pickFlows.includes(f.flowId)) };
  }, [pages, input, pickScreens, pickFlows]);
  const files = useMemo(() => scaffoldTests(sheet, framework, { dir: dir.trim() || "tests" }), [sheet, framework, dir]);
  const total = files.reduce((n, f) => n + f.cases, 0);
  const shown = files.find((f) => f.path === open) ?? files[0];
  const multi = (e: React.ChangeEvent<HTMLSelectElement>) => Array.from(e.target.selectedOptions, (o) => o.value);
  const all = files.map((f) => `// ===== ${f.path} =====\n${f.content}`).join("\n");

  return (
    <Section title="テスト雛形" hint="テスト観点表 (画面入力の境界値・処理の分岐) から、観点の ID を題名にした未実装のテストを作ります。操作と検証は、実装に合わせて書き足してください。" testId="an-scaffold">
      <div className="an-form-row">
        <label>テストの種類<select className="an-input" value={framework} onChange={(e) => setFramework(e.target.value as TestFramework)} data-testid="an-scaffold-framework">{(Object.keys(TEST_FRAMEWORK_LABELS) as TestFramework[]).map((f) => <option key={f} value={f}>{TEST_FRAMEWORK_LABELS[f]}</option>)}</select></label>
        <label>出力先のフォルダ<input className="an-input" value={dir} onChange={(e) => setDir(e.target.value)} /></label>
        <label>画面 (選ばなければ全部)<select multiple size={5} className="an-input" value={pickScreens} onChange={(e) => setPickScreens(multi(e))} aria-label="対象の画面">{pages.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}</select></label>
        <label>処理フロー (選ばなければ全部)<select multiple size={5} className="an-input" value={pickFlows} onChange={(e) => setPickFlows(multi(e))} aria-label="対象の処理フロー">{input.flows.map((f) => <option key={f.meta.id} value={f.meta.id}>{f.meta.name ?? f.meta.id}</option>)}</select></label>
      </div>
      {files.length === 0 ? <Empty>テスト観点がありません (入力のある画面・分岐のある処理が必要です)。</Empty> : (
        <>
          <p className="an-hint" data-testid="an-scaffold-count">{files.length} ファイル・テスト観点 {total} 件</p>
          <AnTable headers={["ファイル", "観点", ""]} rows={files.map((f) => [<code key="p">{f.path}</code>, f.cases, <button key="b" type="button" className="an-btn" onClick={() => setOpen(f.path)}>中身を見る</button>])} />
          {shown && <Preview title={shown.path} text={shown.content} filename={shown.path.split("/").pop()!} mime="text/plain" />}
          <div className="an-row"><button type="button" className="an-btn" onClick={() => saveTextFile("test-scaffold.txt", all)}>全ファイルを 1 つのテキストで保存</button><span className="an-hint">ファイルごとの保存は、上の「中身を見る」から。</span></div>
        </>
      )}
    </Section>
  );
}

function TestData({ input }: { input: DesignDocInput }) {
  const [pick, setPick] = useState<string[]>([]);
  const [rows, setRows] = useState(10);
  const [seed, setSeed] = useState(1);
  const [nulls, setNulls] = useState(false);
  const [format, setFormat] = useState<"sql" | "csv" | "json">("sql");
  const [quote, setQuote] = useState<SqlQuote>("standard");
  const res = useMemo(() => generateTestData(input, { rowsPerTable: rows, seed, nulls, ...(pick.length ? { tableIds: pick } : {}) }), [input, rows, seed, nulls, pick]);
  const csvTable = res.tables.length === 1 ? res.tables[0] : null;
  const text = format === "sql" ? testDataToInsertSql(res, quote) : format === "csv" ? (csvTable ? testDataTableToCsv(csvTable) : "") : JSON.stringify(res.tables.map((t) => ({ table: t.table.physicalName, columns: t.columns, rows: t.rows })), null, 2);

  return (
    <Section title="テストデータ" hint="テーブルの定義 (型・長さ・NOT NULL・主キー・一意・外部キー・単純な CHECK) に沿ったサンプルの行を作ります。同じ設定なら同じデータです。" testId="an-testdata">
      <div className="an-form-row">
        <label>テーブル (選ばなければ全部)<select multiple size={6} className="an-input" value={pick} onChange={(e) => setPick(Array.from(e.target.selectedOptions, (o) => o.value))} aria-label="対象のテーブル">{input.tables.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}</select></label>
        <label>1 テーブルの行数 (1〜1000)<input className="an-input" type="number" min={1} max={1000} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} data-testid="an-testdata-rows" /></label>
        <label>seed (同じ値なら同じデータ)<input className="an-input" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
        <label className="an-check"><input type="checkbox" checked={nulls} onChange={(e) => setNulls(e.target.checked)} /> NULL を許す列に NULL も入れる</label>
        <label>形式<select className="an-input" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} data-testid="an-testdata-format"><option value="sql">INSERT 文</option><option value="csv">CSV (テーブル 1 つだけ)</option><option value="json">JSON</option></select></label>
        {format === "sql" && <label>引用の形式<select className="an-input" value={quote} onChange={(e) => setQuote(e.target.value as SqlQuote)}><option value="standard">標準 (&quot;列&quot;)</option><option value="mysql">MySQL (`列`)</option><option value="sqlserver">SQL Server ([列])</option></select></label>}
      </div>
      {res.warnings.length > 0 && <ul className="an-list an-warn" data-testid="an-testdata-warnings">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {res.tables.length === 0 ? <Empty>テーブルがありません。</Empty> : format === "csv" && !csvTable ? <Empty>CSV は、テーブルを 1 つだけ選んだときに出せます。</Empty> : (
        <Preview title={`${res.tables.length} テーブル・${res.tables.reduce((n, t) => n + t.rows.length, 0)} 行`} text={text}
          filename={format === "csv" ? `${csvTable!.table.physicalName}.csv` : format === "json" ? "test-data.json" : "test-data.sql"} mime={format === "csv" ? "text/csv" : format === "json" ? "application/json" : "text/plain"}
          extra="外部キーの親のテーブルは、選ばなくても先に作ります (出力は選んだテーブルだけ)" />
      )}
    </Section>
  );
}

function OpenApi({ input }: { input: DesignDocInput }) {
  const [title, setTitle] = useState(input.project.name);
  const [version, setVersion] = useState("1.0.0");
  const res = useMemo(() => buildOpenApi(input, { title, version }), [input, title, version]);
  const text = useMemo(() => JSON.stringify(res.document, null, 2), [res]);
  return (
    <Section title="OpenAPI" hint="処理フローのアクションが持つ HTTP の契約 (メソッド・パス・入力・応答・認証) から、OpenAPI 3.0.3 (JSON) を作ります。" testId="an-openapi">
      <div className="an-form-row">
        <label>タイトル<input className="an-input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>版<input className="an-input" value={version} onChange={(e) => setVersion(e.target.value)} /></label>
      </div>
      <p className="an-hint" data-testid="an-openapi-count">{res.operations} 操作を書き出し、HTTP の契約の無いアクション {res.skipped} 件は含めていません。</p>
      {res.warnings.length > 0 && <ul className="an-list an-warn">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {res.operations > 0 && <Preview title="openapi.json" text={text} filename="openapi.json" mime="application/json" />}
    </Section>
  );
}

type DiagramPick = "mermaid" | "plantuml" | "svg";

/** ER 図・画面遷移図・処理フロー図・業務フロー図を、他のドキュメントへ貼れる形で書き出す (設計は書き換えない) */
function Diagrams({ input }: { input: DesignDocInput }) {
  const targets = useMemo(() => diagramTargets(input), [input]);
  const [idx, setIdx] = useState(0);
  const [format, setFormat] = useState<DiagramPick>("mermaid");
  const [actionIdx, setActionIdx] = useState(0);
  const target = targets[Math.min(idx, targets.length - 1)];
  const flow = target?.kind === "processFlow" ? input.flows.find((f) => f.meta.id === target.id) : undefined;
  const svgOk = target?.kind === "processFlow" || target?.kind === "businessFlow";
  const effective: DiagramPick = format === "svg" && !svgOk ? "mermaid" : format;
  const result = useMemo(() => {
    if (!target) return null;
    if (effective === "svg") {
      const svg = target.kind === "processFlow" ? processFlowSvg(input, target.id!, Math.min(actionIdx, Math.max((flow?.actions.length ?? 1) - 1, 0))) : businessFlowSvg(input, target.id!);
      return svg ? { text: svg, ext: "svg", mime: "image/svg+xml" } : null;
    }
    const text = buildDiagramText(input, target, effective as DiagramFormat);
    return text ? { text, ext: effective === "mermaid" ? "mmd" : "puml", mime: "text/plain" } : null;
  }, [input, target, effective, actionIdx, flow]);
  const file = `${target ? diagramFileStem(target) : "diagram"}.${result?.ext ?? "txt"}`;

  return (
    <Section title="図の書き出し" hint="ER 図・画面遷移図・処理フロー図・業務フロー図を、Markdown・Wiki・他の設計書に貼れる形で書き出します。Mermaid は GitHub や多くの Wiki がそのまま描画します。SVG は処理フロー・業務フローだけです (設計書と同じ描画)。" testId="an-diagrams">
      <div className="an-form-row">
        <label>図の対象
          <select className="an-input" value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setActionIdx(0); }} data-testid="an-diagram-target">
            {targets.map((t, i) => <option key={`${t.kind}-${t.id ?? ""}`} value={i}>{t.label}</option>)}
          </select>
        </label>
        <fieldset className="an-form-row" aria-label="形式" style={{ border: 0, padding: 0, margin: 0 }}>
          {(["mermaid", "plantuml", "svg"] as DiagramPick[]).map((f) => (
            <label key={f} className="an-check"><input type="radio" name="an-diagram-format" checked={effective === f} disabled={f === "svg" && !svgOk} onChange={() => setFormat(f)} data-testid={`an-diagram-format-${f}`} /> {f === "svg" ? "SVG" : DIAGRAM_FORMAT_LABELS[f]}</label>
          ))}
        </fieldset>
        {flow && flow.actions.length > 1 && effective === "svg" && (
          <label>処理 (SVG は 1 つずつ)
            <select className="an-input" value={actionIdx} onChange={(e) => setActionIdx(Number(e.target.value))}>{flow.actions.map((a, i) => <option key={i} value={i}>{a.name ?? `処理 ${i + 1}`}</option>)}</select>
          </label>
        )}
      </div>
      {!result ? <Empty>この図は作れませんでした (対象の設計が見つかりません)。</Empty> : (
        <div className="an-preview" data-testid="an-diagram-preview">
          <div className="an-row"><b>{file}</b><span className="an-spacer" />
            <button type="button" className="an-btn" onClick={() => void copyText(result.text)} data-testid="an-diagram-copy"><i className="bi bi-clipboard" /> コピー</button>
            <button type="button" className="an-btn primary" onClick={() => saveTextFile(file, result.text, result.mime)} data-testid="an-diagram-save"><i className="bi bi-download" /> 保存</button>
          </div>
          {result.ext === "svg" && <div className="an-code an-paper" data-theme-audit-skip><img alt="図のプレビュー" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.text)}`} style={{ maxWidth: "100%" }} /></div>}
          <pre className="an-code"><code>{result.text}</code></pre>
        </div>
      )}
    </Section>
  );
}
