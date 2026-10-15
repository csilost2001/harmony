/**
 * OpenAPI (JSON) の取り込み。operation (メソッド + パス) ごとに、処理フローの骨組みを作る:
 * 入口 (HTTP の契約: メソッド・パス・認証)・入力 (パス・クエリ・本文の項目)・出力・応答の一覧。処理の中身 (工程) は空で、設計者が書く。
 * YAML は読まない (JSON に変換してから取り込む)。`$ref` は、同じ文書の中 (`#/...`) だけ解決する。
 */
type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export interface ImportedFlow { id: string; name: string; method: string; path: string; flow: { meta: Json; actions: Json[] } }
export interface OpenApiImportResult { flows: ImportedFlow[]; warnings: string[]; title?: string }

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const MAX_OPERATIONS = 500;
/** 結果の大きさの上限 (共通のスキーマを多数の operation から `$ref` で参照すると、小さな文書が巨大な結果になる)。超えたら、警告して打ち切る */
const MAX_PROPS_PER_SCHEMA = 200;
const MAX_FIELDS_PER_OPERATION = 300;
const MAX_TOTAL_FIELDS = 50_000;
/** 文字列・数・警告の上限 (長い文字列や大量のキーを、共有 (`$ref`) で多数の operation に複製させない) */
const MAX_ID_SOURCE = 200;
const MAX_NAME = 100;
const MAX_TEXT = 2000;
const MAX_PATH = 500;
const MAX_RESPONSES = 100;
const MAX_MEDIA_TYPES = 50;
const MAX_REF_CHARS = 500;
const MAX_WARNINGS = 100;
const clip = (v: unknown, n: number): string => (typeof v === "string" ? v.slice(0, n) : "");

const kebab = (s: string): string => {
  const t = s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 63);
  return /^[a-z]/.test(t) ? t : `api-${t}`.replace(/-+$/, "");
};
const camel = (s: string): string => {
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const t = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join("");
  return /^[A-Za-z]/.test(t) ? t : `p${t}`;
};

const STATUS_SLUG: Record<number, string> = { 200: "ok", 201: "created", 202: "accepted", 204: "no-content", 301: "moved", 302: "found", 304: "not-modified", 400: "bad-request", 401: "unauthorized", 403: "forbidden", 404: "not-found", 405: "method-not-allowed", 409: "conflict", 410: "gone", 422: "unprocessable", 429: "too-many-requests", 500: "server-error", 502: "bad-gateway", 503: "unavailable" };

export function importOpenApi(doc: unknown): OpenApiImportResult {
  // 注意は、同じ文を 1 回だけ・100 件まで (数億件の警告が、画面を止めないように)。超えた分は「ほか N 件」
  const warnSet = new Set<string>();
  let warnExtra = 0;
  const warn = (m: string): void => { if (warnSet.has(m)) return; if (warnSet.size >= MAX_WARNINGS) { warnExtra++; return; } warnSet.add(m); };
  const finish = (): string[] => [...warnSet, ...(warnExtra ? [`ほか ${warnExtra} 件の注意があります`] : [])];
  const warnings = { push: (...ms: string[]) => { for (const m of ms) warn(m); } };
  if (!isRecord(doc) || !isRecord(doc.paths)) return { flows: [], warnings: ["OpenAPI の文書として読めません (paths がありません)"] };
  const version = typeof doc.openapi === "string" ? doc.openapi : typeof doc.swagger === "string" ? `swagger ${doc.swagger}` : "";
  if (!version.startsWith("3") && !version.startsWith("swagger 2")) warnings.push("openapi の版が読めません。3.x として読みます");

  // 共有 (`$ref`) されたオブジェクトは、operation ごとに同じものが来る。キーの数え上げと、参照の解決は、同じものを 1 回だけにする
  // (キーの数 × operation 数、文字列の長さ × 回数の時間にならないように)
  const keyCache = new WeakMap<object, string[]>();
  const KEEP_KEYS = Math.max(MAX_PROPS_PER_SCHEMA, MAX_RESPONSES, MAX_MEDIA_TYPES) + 1;
  const firstKeys = (o: Json): string[] => {
    let ks = keyCache.get(o);
    if (!ks) { ks = Object.keys(o).slice(0, KEEP_KEYS); keyCache.set(o, ks); }
    return ks;
  };
  const refCache = new Map<string, unknown>();

  const resolve = (v: unknown, depth = 0): unknown => {
    if (!isRecord(v) || typeof v.$ref !== "string") return v;
    if (depth > 8) return {};
    const ref = v.$ref;
    if (ref.length > MAX_REF_CHARS) { warn(`長すぎる参照 ($ref) は、解決しません (${MAX_REF_CHARS} 字まで)`); return {}; }
    const key = `${depth}|${ref}`;
    if (refCache.has(key)) return refCache.get(key);
    const done = (r: unknown): unknown => { refCache.set(key, r); return r; };
    if (!ref.startsWith("#/")) { warnings.push(`外部の参照 (${ref.slice(0, 60)}) は解決しません`); return done({}); }
    let cur: unknown = doc;
    for (const seg of ref.slice(2).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      if (!isRecord(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return done({});
      cur = cur[seg];
    }
    return done(resolve(cur, depth + 1));
  };

  const fieldType = (schema: unknown, depth = 0): unknown => {
    const s = resolve(schema) as Json;
    if (!isRecord(s)) return "string";
    if (s.type === "array") return depth > 3 ? { kind: "array", itemType: "json" } : { kind: "array", itemType: fieldType(s.items, depth + 1) };
    if (s.type === "integer") return "integer";
    if (s.type === "number") return "number";
    if (s.type === "boolean") return "boolean";
    if (s.type === "object" || isRecord(s.properties)) return "json";
    if (s.type === "string" && s.format === "date") return "date";
    if (s.type === "string" && s.format === "date-time") return "datetime";
    return "string";
  };
  const field = (name: string, schema: unknown, required: boolean, description?: unknown, label?: unknown) => {
    const s = resolve(schema) as Json;
    return {
      name: camel(name.slice(0, MAX_NAME)), type: fieldType(schema), ...(required ? { required: true } : {}),
      ...(typeof label === "string" && label ? { label: label.slice(0, MAX_NAME) } : {}),
      ...(typeof description === "string" && description ? { description: description.slice(0, MAX_TEXT) } : isRecord(s) && typeof s.description === "string" ? { description: s.description.slice(0, MAX_TEXT) } : {}),
    };
  };
  let totalFields = 0;
  const truncated = new Set<string>();
  const bodyFields = (schema: unknown, where: string): Json[] => {
    const s = resolve(schema) as Json;
    if (!isRecord(s) || !isRecord(s.properties)) return [];
    const req = new Set(Array.isArray(s.required) ? s.required.slice(0, 5000).filter((x): x is string => typeof x === "string") : []);
    const room = Math.max(0, Math.min(MAX_PROPS_PER_SCHEMA, MAX_TOTAL_FIELDS - totalFields));
    // 全部のキーを数え上げない (共有されたスキーマを operation ごとに数え上げると、キーの数 × operation 数の時間になる)。room を超える 1 個目で止める
    const all = firstKeys(s.properties as Json);
    if (all.length > room) truncated.add(`${where}: 項目が多いため、先頭の ${room} 個までにしました (1 つのスキーマは ${MAX_PROPS_PER_SCHEMA} 個、全体は ${MAX_TOTAL_FIELDS} 個まで)`);
    const keys = all.slice(0, room);
    const out = keys.map((k) => field(k, (s.properties as Json)[k], req.has(k)));
    totalFields += out.length;
    return out;
  };
  const jsonSchemaOf = (content: unknown): unknown => {
    const c = resolve(content);
    if (!isRecord(c)) return undefined;
    let media: unknown = isRecord(c["application/json"]) ? c["application/json"] : undefined;
    if (!media) for (const k of firstKeys(c).slice(0, MAX_MEDIA_TYPES)) { if (isRecord(c[k])) { media = c[k]; break; } }
    return isRecord(media) ? media.schema : undefined;
  };

  const flows: ImportedFlow[] = [];
  const usedIds = new Set<string>();
  const globalSecurity = Array.isArray(doc.security) && doc.security.length > 0;
  let count = 0;
  for (const [path, item] of Object.entries(doc.paths)) {
    const pathItem = resolve(item);
    if (!isRecord(pathItem)) continue;
    for (const method of METHODS) {
      const opRaw = pathItem[method];
      if (!isRecord(opRaw)) continue;
      if (++count > MAX_OPERATIONS) { warnings.push(`operation が多すぎるため、${MAX_OPERATIONS} 件までにしました`); return { flows, warnings: finish(), ...(isRecord(doc.info) && typeof doc.info.title === "string" ? { title: doc.info.title } : {}) }; }
      const op = opRaw;
      const where = `${method.toUpperCase()} ${path.slice(0, 80)}`;
      const opId = clip(op.operationId, MAX_ID_SOURCE) || `${method}-${path.slice(0, MAX_ID_SOURCE)}`;
      // id は、先頭 200 字から 1 回だけ作る。重複は、番号を付けて避ける (長い文字列に、何度も掛け直さない)
      const baseId = kebab(opId);
      let id = baseId;
      for (let n = 2; usedIds.has(id); n++) id = `${baseId.slice(0, 58)}-${n}`;
      usedIds.add(id);
      const name = (clip(op.summary, MAX_NAME).trim() || opId).slice(0, MAX_NAME);
      // 共有したパラメータが operation ごとに複製されるので、読む数にも上限を掛ける (本文の項目と同じ上限)
      const pathParams: unknown[] = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
      const opParams: unknown[] = Array.isArray(op.parameters) ? op.parameters : [];
      // 複写の前に切る (共有した巨大な配列を、operation ごとに全体複写しない)
      const rawParams = [...pathParams.slice(0, MAX_FIELDS_PER_OPERATION + 1), ...opParams.slice(0, MAX_FIELDS_PER_OPERATION + 1)];
      if (rawParams.length > MAX_FIELDS_PER_OPERATION) truncated.add(`${where}: パラメータが多いため、先頭の ${MAX_FIELDS_PER_OPERATION} 個までにしました`);
      const params = rawParams.slice(0, MAX_FIELDS_PER_OPERATION).map((p) => resolve(p)).filter(isRecord);
      const inputs: Json[] = [];
      const seen = new Set<string>();
      for (const p of params) {
        if ((p.in !== "path" && p.in !== "query") || typeof p.name !== "string") continue;
        if (totalFields >= MAX_TOTAL_FIELDS) { truncated.add(`全体の項目が ${MAX_TOTAL_FIELDS} 個を超えたため、以降のパラメータは読みませんでした`); break; }
        const f = field(p.name, p.schema, p.in === "path" || p.required === true, p.description);
        if (!seen.has(f.name)) { seen.add(f.name); inputs.push(f); totalFields++; }
      }
      const reqBody = resolve(op.requestBody);
      if (isRecord(reqBody)) for (const f of bodyFields(jsonSchemaOf(reqBody.content), `${where} の要求`)) if (!seen.has(f.name as string) && inputs.length < MAX_FIELDS_PER_OPERATION) { seen.add(f.name as string); inputs.push(f); }
      const responses: Json[] = [];
      let outputs: Json[] = [];
      const respMap = isRecord(op.responses) ? op.responses : {};
      let skippedCodes = 0;
      let seenCodes = 0;
      const codeKeys = firstKeys(respMap);
      for (const code of codeKeys) {
        if (++seenCodes > MAX_RESPONSES) { truncated.add(`${where}: 応答が多いため、先頭の ${MAX_RESPONSES} 個までにしました`); break; }
        const rRaw = respMap[code];
        const status = /^\d{3}$/.test(code) ? Number(code) : NaN;
        if (!Number.isInteger(status)) { skippedCodes++; continue; }
        const r = resolve(rRaw);
        const rid = `${status}-${STATUS_SLUG[status] ?? "response"}`;
        responses.push({ id: rid, status, ...(isRecord(r) && typeof r.description === "string" && r.description ? { description: r.description.slice(0, MAX_TEXT) } : {}) });
        if (status >= 200 && status < 300 && !outputs.length && isRecord(r)) outputs = bodyFields(jsonSchemaOf(r.content), `${where} の応答`).slice(0, MAX_FIELDS_PER_OPERATION);
      }
      if (skippedCodes) warn(`${where}: ステータスの数字でない応答のコード ${skippedCodes} 個 (default など) は、読み飛ばしました`);
      const secured = Array.isArray(op.security) ? op.security.length > 0 : globalSecurity;
      flows.push({
        id, name, method: method.toUpperCase(), path: path.slice(0, MAX_PATH),
        flow: {
          meta: { id, name, ...(typeof op.description === "string" && op.description ? { description: op.description.slice(0, 2000) } : {}), flowType: "common", maturity: "draft" },
          actions: [{
            id: "act-001", name, trigger: "submit", maturity: "draft",
            httpRoute: { method: method.toUpperCase(), path: path.slice(0, MAX_PATH).replace(/\{([A-Za-z_]\w*)\}/g, ":$1"), auth: secured ? "required" : "none" },
            ...(inputs.length ? { inputs } : {}), ...(outputs.length ? { outputs } : {}), ...(responses.length ? { responses } : {}),
            steps: [],
          }],
        },
      });
    }
  }
  warnings.push(...truncated);
  if (!flows.length) warnings.push("取り込める operation (get / post / put / patch / delete) がありません");
  return { flows, warnings: finish(), ...(isRecord(doc.info) && typeof doc.info.title === "string" ? { title: doc.info.title } : {}) };
}
