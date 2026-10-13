/**
 * 外部インタフェースの整合検査。処理フローの外部システム呼び出し (呼び出し側) と、相手の OpenAPI の定義 (提供側) を突き合わせ、
 * 相手の定義に無いパス・メソッド・operationId の呼び出しと、定義にあるのに誰も呼んでいない操作を見つける。
 * 照合できるのは、ワークスペース内のファイルの JSON 形式の OpenAPI だけ (URL の定義は、取りに行かない。YAML は読まない)。
 */
import type { DesignDocInput } from "../designDocument.js";
import { forEachStep } from "./common.js";

export interface ExternalSpecSummary {
  source: string;
  /** 読めなかった理由 */
  error?: string;
  /** 照合しなかった理由 (url = URL で指す定義は取りに行かない) */
  skipped?: "url";
  operations: Array<{ method: string; path: string; operationId?: string }>;
}

export interface ExternalCall {
  flow: { id: string; name: string };
  systemRef: string;
  method?: string;
  path?: string;
  operationId?: string;
  result: "ok" | "missing-path" | "missing-method" | "unknown-operation" | "not-checked";
  note?: string;
}
export interface ExternalSystemReport {
  /** 設定の場所 (処理フローごとのカタログ。同じ定義を指していれば、まとめる) */
  source: string | null;
  systemNames: string[];
  status: "checked" | "url-skipped" | "error" | "no-spec";
  error?: string;
  calls: ExternalCall[];
  /** 定義にあるのに、どの処理フローも呼んでいない操作 */
  uncalled: string[];
}

/** パスの比較用: クエリを除き、`{id}` / `:id` / `${...}` / `@var` の段をそろえ、末尾の / を除く */
export function normalizeApiPath(p: string): string {
  const noQuery = p.split("?")[0].split("#")[0];
  const segs = noQuery.split("/").map((seg) => (/^(\{[^}]*\}|:[A-Za-z_][\w]*|\$\{[^}]*\}|@[\w.]+)$/.test(seg) || /\{[^}]*\}|\$\{[^}]*\}/.test(seg) ? "{}" : seg));
  const out = segs.join("/").replace(/\/+$/, "");
  return out === "" ? "/" : out;
}

/** `/v1/payment_intents POST` のような operationRef を、メソッドとパスに分ける */
function parseOperationRef(ref: string): { method: string; path: string } | null {
  const m = /^\s*(\/\S*)\s+(GET|POST|PUT|PATCH|DELETE)\s*$/i.exec(ref) ?? (() => { const n = /^\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)\s*$/i.exec(ref); return n ? [n[0], n[2], n[1]] : null; })();
  return m ? { method: m[2].toUpperCase(), path: m[1] } : null;
}

export function checkExternalContracts(input: DesignDocInput): ExternalSystemReport[] {
  const specs = input.externalSpecs ?? {};
  const reports = new Map<string, ExternalSystemReport>();
  const reportFor = (source: string | null, name: string): ExternalSystemReport => {
    const k = source ?? "";
    const r = reports.get(k) ?? reports.set(k, { source, systemNames: [], status: "no-spec", calls: [], uncalled: [] }).get(k)!;
    if (!r.systemNames.includes(name)) r.systemNames.push(name);
    return r;
  };
  const called = new Map<string, Set<string>>(); // source → "METHOD normalizedPath"

  for (const f of input.flows) {
    const catalog = f.context?.catalogs?.externalSystems ?? {};
    for (const a of f.actions) forEachStep(a.steps, (st) => {
      if (st.kind !== "externalSystem") return;
      const x = st as Record<string, unknown>;
      const systemRef = String(x.systemRef ?? "");
      const entry = catalog[systemRef];
      const source = entry?.openApiSpec?.trim() || null;
      const rep = reportFor(source, entry?.name ?? systemRef);
      const http = (x.httpCall ?? {}) as { method?: string; path?: string };
      const op = typeof x.operationRef === "string" ? parseOperationRef(x.operationRef) : null;
      const method = (http.method ?? op?.method)?.toUpperCase();
      const path = http.path ?? op?.path;
      const operationId = typeof x.operationId === "string" ? x.operationId : undefined;
      const call: ExternalCall = { flow: { id: f.meta.id, name: f.meta.name ?? f.meta.id }, systemRef, ...(method ? { method } : {}), ...(path ? { path } : {}), ...(operationId ? { operationId } : {}), result: "not-checked" };
      rep.calls.push(call);
      const spec = source ? specs[source] : undefined;
      if (!source) return;
      if (!spec) return;
      if (spec.skipped === "url") { rep.status = "url-skipped"; return; }
      if (spec.error) { rep.status = "error"; rep.error = spec.error; return; }
      rep.status = "checked";
      const mark = called.get(source) ?? called.set(source, new Set()).get(source)!;
      if (operationId && !path) {
        const hit = spec.operations.find((o) => o.operationId === operationId);
        if (hit) { call.result = "ok"; mark.add(`${hit.method} ${normalizeApiPath(hit.path)}`); }
        else { call.result = "unknown-operation"; call.note = `operationId「${operationId}」が相手の定義にありません`; }
        return;
      }
      if (!path) return;
      // 呼び出し側が baseUrl のパス (/v1 など) を除いて書いていても合うように、baseUrl のパスを足した形も試す
      let basePrefix = "";
      try { if (entry?.baseUrl) basePrefix = new URL(entry.baseUrl, "http://x").pathname.replace(/\/+$/, ""); } catch { /* 読めない baseUrl は無視 */ }
      const candidates = [normalizeApiPath(path), ...(basePrefix && basePrefix !== "/" ? [normalizeApiPath(`${basePrefix}${path.startsWith("/") ? "" : "/"}${path}`)] : [])];
      const np = candidates.find((c) => spec.operations.some((o) => normalizeApiPath(o.path) === c)) ?? candidates[0];
      const samePath = spec.operations.filter((o) => normalizeApiPath(o.path) === np);
      if (!samePath.length) { call.result = "missing-path"; call.note = `パス ${path} が相手の定義にありません`; return; }
      if (method && !samePath.some((o) => o.method.toUpperCase() === method)) { call.result = "missing-method"; call.note = `${path} に ${method} がありません (定義にあるのは ${samePath.map((o) => o.method.toUpperCase()).join(" / ")})`; return; }
      call.result = "ok";
      mark.add(`${method ?? samePath[0].method.toUpperCase()} ${np}`);
    });
  }
  for (const r of reports.values()) {
    if (r.source === null) { r.status = "no-spec"; continue; }
    const spec = specs[r.source];
    if (!spec) { r.status = "error"; r.error = "この定義のファイルを読み込めていません"; continue; }
    if (spec.skipped === "url") r.status = "url-skipped";
    else if (spec.error) { r.status = "error"; r.error = spec.error; }
    else {
      r.status = "checked";
      const seen = called.get(r.source) ?? new Set<string>();
      r.uncalled = spec.operations.map((o) => `${o.method.toUpperCase()} ${o.path}`).filter((label, i) => !seen.has(`${spec.operations[i].method.toUpperCase()} ${normalizeApiPath(spec.operations[i].path)}`));
    }
  }
  return [...reports.values()];
}

/** OpenAPI の文書 (JSON を読んだもの) から、照合に要る部分だけを取り出す */
export function summarizeOpenApi(source: string, doc: unknown): ExternalSpecSummary {
  const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isRec(doc) || !isRec(doc.paths)) return { source, error: "OpenAPI の定義ではありません (paths がありません)", operations: [] };
  // servers の最初の URL にパスの接頭辞 (/v1 など) があれば、呼び出し側のパスと合わせる
  let prefix = "";
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  const url = isRec(servers[0]) && typeof servers[0].url === "string" ? servers[0].url : "";
  try { if (url) prefix = new URL(url, "http://x").pathname.replace(/\/+$/, ""); } catch { /* 読めない server は無視 */ }
  const operations: ExternalSpecSummary["operations"] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!isRec(item)) continue;
    for (const m of ["get", "post", "put", "patch", "delete"]) {
      const op = item[m];
      if (isRec(op)) operations.push({ method: m.toUpperCase(), path: `${prefix === "/" ? "" : prefix}${path}`, ...(typeof op.operationId === "string" ? { operationId: op.operationId } : {}) });
    }
  }
  return { source, operations };
}
