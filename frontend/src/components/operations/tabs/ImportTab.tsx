/**
 * 既存資産の取り込み: DDL (CREATE TABLE) → テーブル定義、OpenAPI (JSON) → 処理フローの骨組み。
 * どちらも、まず予行 (何が作られるか・既にあるものは作らない・読み飛ばしたもの) を見せ、選んだものだけを新規に作る。既存の設計は上書きしない。
 * Excel (.xlsx) の表は、テーブルの「カラムを貼り付け」・画面項目の「項目を貼り付け」の、Excel ファイルの読み込みから。
 */
import { useMemo, useState } from "react";
import { importOpenApi, parseDdl, type ImportedTable } from "@harmony/shared";
import { Section } from "../../analysis/ui";
import { saveTable, listTables } from "../../../store/tableStore";
import { createProcessFlow, listProcessFlows, saveProcessFlow } from "../../../store/processFlowStore";
import { reportFailure } from "../../../utils/failureToast";
import { showToast } from "../../../utils/toast";
import { generateUUID } from "../../../utils/uuid";
import { readFileBytes } from "../../../utils/inflate";
import { useLoad } from "../useLoad";

const ts = () => new Date().toISOString();

export function ImportTab() {
  return (
    <div className="an-pane" data-testid="op-import">
      <DdlImport />
      <OpenApiImport />
      <Section title="Excel の表" testId="op-import-excel"><p className="an-hint">Excel (.xlsx) のカラム定義・画面項目の表は、テーブル編集の「カラムを貼り付け」と、画面項目の「項目を貼り付け」にある「Excel ファイルを読む」から取り込みます (貼り付けと同じ予行と重複の確認が出ます)。</p></Section>
    </div>
  );
}

async function readText(file: File): Promise<string> {
  const bytes = await readFileBytes(file);
  return new TextDecoder("utf-8").decode(bytes);
}

function DdlImport() {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const existing = useLoad(() => listTables(), false);
  const result = useMemo(() => (text.trim() ? parseDdl(text) : null), [text]);
  const have = new Set((existing.data ?? []).map((t) => t.id));
  const havePhysical = new Set((existing.data ?? []).map((t) => (t as { physicalName?: string }).physicalName).filter(Boolean));
  const status = (t: ImportedTable): "new" | "exists" => (have.has(t.id) || havePhysical.has(t.physicalName) ? "exists" : "new");
  const fresh = result?.tables.filter((t) => status(t) === "new") ?? [];
  const chosen = fresh.filter((t) => picked.has(t.id));

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try { const t = await readText(f); setText(t); setPicked(new Set(parseDdl(t).tables.map((x) => x.id))); } catch (e) { reportFailure(e, "DDL ファイルの読み込み"); }
  };
  const apply = async () => {
    setBusy(true);
    try {
      let n = 0;
      for (const t of chosen) {
        const now = ts();
        await saveTable({ $schema: "", ...t, uuid: generateUUID(), maturity: "draft", createdAt: now, updatedAt: now } as never);
        n++;
      }
      showToast(`${n} 件のテーブルを取り込みました`);
      setText(""); setPicked(new Set()); existing.reload();
    } catch (e) { reportFailure(e, "DDL の取り込み"); } finally { setBusy(false); }
  };

  return (
    <Section title="DDL → テーブル" testId="op-import-ddl" hint="pg_dump -s・mysqldump --no-data・手書きの CREATE TABLE を取り込みます (型・NOT NULL・既定値・主キー・一意・外部キー・インデックス・コメント)。スキーマにない型は VARCHAR にし、元の型を備考に残します。">
      <div className="an-row"><label className="an-btn">SQL ファイルを選ぶ<input type="file" accept=".sql,.ddl,.txt,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="op-ddl-file" /></label><span className="an-hint">または、下に貼り付けます (取り込めるのは 20 MB まで)。</span></div>
      <textarea className="an-input op-ta" rows={7} value={text} onChange={(e) => { setText(e.target.value); setPicked(new Set(parseDdl(e.target.value).tables.map((x) => x.id))); }} placeholder={"例:\nCREATE TABLE orders (\n  id BIGINT PRIMARY KEY,\n  customer_id BIGINT NOT NULL REFERENCES customers(id)\n);"} aria-label="DDL" data-testid="op-ddl-text" />
      {result && (
        <div className="op-preview" data-testid="op-ddl-preview">
          {result.tables.length === 0 ? <p className="an-alert" role="alert">CREATE TABLE が見つかりませんでした。</p> : (
            <table className="an-table"><thead><tr><th scope="col"><span className="an-sr">選ぶ</span></th><th scope="col">テーブル</th><th scope="col">id</th><th scope="col">列</th><th scope="col">制約・インデックス</th><th scope="col">結果</th></tr></thead>
              <tbody>
                {result.tables.map((t) => {
                  const st = status(t);
                  return (
                    <tr key={t.id} data-testid="op-ddl-row">
                      <td><input type="checkbox" disabled={st !== "new"} checked={st === "new" && picked.has(t.id)} onChange={() => setPicked((c) => { const n = new Set(c); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} aria-label={`${t.physicalName} を取り込む`} /></td>
                      <td><code>{t.physicalName}</code>{t.name !== t.physicalName ? <small> {t.name}</small> : null}</td><td><code>{t.id}</code></td><td>{t.columns.length}</td><td>{t.constraints.length + t.indexes.length}</td>
                      <td>{st === "new" ? "新規に作る" : <span className="an-warn">同じ id・物理名が既にあるため、作りません</span>}</td>
                    </tr>
                  );
                })}
              </tbody></table>
          )}
          {result.warnings.length > 0 && <details open><summary>注意 ({result.warnings.length} 件)</summary><ul className="an-list" data-testid="op-ddl-warnings">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          {result.skipped.length > 0 && <details><summary>読み飛ばしたもの ({result.skipped.length} 件)</summary><ul className="an-list" data-testid="op-ddl-skipped">{result.skipped.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          <div className="an-row"><button type="button" className="an-btn primary" disabled={busy || chosen.length === 0} onClick={() => void apply()} data-testid="op-ddl-apply"><i className="bi bi-box-arrow-in-down" /> 選んだ {chosen.length} 件を取り込む</button><span className="an-hint">既存のテーブルは上書きしません。取り込んだテーブルは「下書き」です。</span></div>
        </div>
      )}
    </Section>
  );
}

function OpenApiImport() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const existing = useLoad(() => listProcessFlows(), false);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try { return importOpenApi(JSON.parse(text)); } catch { return { flows: [], warnings: ["JSON として読めません (YAML の場合は、JSON に変換してから貼り付けてください)"] }; }
  }, [text]);
  const have = new Set((existing.data ?? []).map((f) => (f as { id: string }).id));
  const fresh = parsed?.flows.filter((f) => !have.has(f.id)) ?? [];
  const chosen = fresh.filter((f) => picked.has(f.id));
  const load = (t: string) => { setText(t); setError(null); try { setPicked(new Set(importOpenApi(JSON.parse(t)).flows.map((f) => f.id))); } catch { setPicked(new Set()); } };
  const onFile = async (f: File | undefined) => { if (!f) return; try { load(await readText(f)); } catch (e) { reportFailure(e, "OpenAPI ファイルの読み込み"); } };

  const apply = async () => {
    setBusy(true); setError(null);
    try {
      let n = 0;
      for (const f of chosen) {
        // 作成は、画面からの新規作成と同じ経路 (一覧への登録を含む)。そのうえで、取り込んだ入口・入力・応答を書き込む
        const created = await createProcessFlow(String(f.flow.meta.name), "common", undefined, typeof f.flow.meta.description === "string" ? f.flow.meta.description : "", { id: f.id });
        await saveProcessFlow({ ...created, actions: f.flow.actions as never });
        n++;
      }
      showToast(`${n} 件の処理フローの骨組みを作りました`);
      setText(""); setPicked(new Set()); existing.reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); reportFailure(e, "OpenAPI の取り込み"); } finally { setBusy(false); }
  };

  return (
    <Section title="OpenAPI → 処理フローの骨組み" testId="op-import-openapi" hint="OpenAPI 3 (JSON) の operation ごとに、処理フローを作ります (入口のメソッド・パス・認証、入力、出力、応答の一覧)。処理の中身 (工程) は空で、設計者が書きます。YAML は JSON に変換してから取り込みます。">
      <div className="an-row"><label className="an-btn">JSON ファイルを選ぶ<input type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="op-openapi-file" /></label><span className="an-hint">または、下に貼り付けます。</span></div>
      <textarea className="an-input op-ta" rows={6} value={text} onChange={(e) => load(e.target.value)} placeholder='例: { "openapi": "3.0.3", "paths": { "/orders": { "get": { "summary": "注文の一覧", "responses": { "200": { "description": "成功" } } } } } }' aria-label="OpenAPI (JSON)" data-testid="op-openapi-text" />
      {parsed && (
        <div className="op-preview" data-testid="op-openapi-preview">
          {parsed.flows.length > 0 && (
            <table className="an-table"><thead><tr><th scope="col"><span className="an-sr">選ぶ</span></th><th scope="col">メソッド</th><th scope="col">パス</th><th scope="col">処理フロー</th><th scope="col">結果</th></tr></thead>
              <tbody>
                {parsed.flows.map((f) => {
                  const exists = have.has(f.id);
                  return (
                    <tr key={f.id} data-testid="op-openapi-row">
                      <td><input type="checkbox" disabled={exists} checked={!exists && picked.has(f.id)} onChange={() => setPicked((c) => { const n = new Set(c); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })} aria-label={`${f.name} を取り込む`} /></td>
                      <td><code>{f.method}</code></td><td><code>{f.path}</code></td><td>{f.name} <small className="an-hint">({f.id})</small></td>
                      <td>{exists ? <span className="an-warn">同じ id があるため、作りません</span> : "新規に作る"}</td>
                    </tr>
                  );
                })}
              </tbody></table>
          )}
          {parsed.warnings.length > 0 && <details open><summary>注意 ({parsed.warnings.length} 件)</summary><ul className="an-list" data-testid="op-openapi-warnings">{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          {error && <p className="an-alert" role="alert">{error}</p>}
          <div className="an-row"><button type="button" className="an-btn primary" disabled={busy || chosen.length === 0} onClick={() => void apply()} data-testid="op-openapi-apply"><i className="bi bi-box-arrow-in-down" /> 選んだ {chosen.length} 件を作る</button><span className="an-hint">既存の処理フローは上書きしません。</span></div>
        </div>
      )}
    </Section>
  );
}
