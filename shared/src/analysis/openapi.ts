/**
 * OpenAPI 3 の書き出し。処理フローのアクションが持つ HTTP の契約 (メソッド・パス・入力・応答・認証) から、OpenAPI 3.0.3 の文書 (JSON) を作る。
 * 一方向の出力 (OpenAPI から処理フローへの取り込みは別の機能)。
 */
import type { DesignDocInput } from "../designDocument.js";

type Json = Record<string, unknown>;

export interface OpenApiResult {
  document: Json;
  /** 書き出したアクションの数 */
  operations: number;
  /** HTTP の契約が無いため書き出さなかったアクションの数 */
  skipped: number;
  warnings: string[];
}

/** 画面項目・処理の入出力の型 (FieldType) を、JSON Schema にする */
export function fieldTypeToSchema(t: unknown): Json {
  if (typeof t === "string") {
    switch (t) {
      case "string": return { type: "string" };
      case "number": return { type: "number" };
      case "integer": return { type: "integer" };
      case "boolean": return { type: "boolean" };
      case "date": return { type: "string", format: "date" };
      case "datetime": return { type: "string", format: "date-time" };
      case "json": return { type: "object" };
      default: return { type: "string" };
    }
  }
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if (o.kind === "array") return { type: "array", items: fieldTypeToSchema(o.itemType) };
    if (o.kind === "tableList") return { type: "array", items: { type: "object" }, description: `テーブル ${String(o.tableId)} の行の一覧` };
    if (o.kind === "tableRow") return { type: "object", description: `テーブル ${String(o.tableId)} の 1 行` };
    if (o.kind === "object" || o.kind === "structure") return { type: "object" };
  }
  return {};
}

const operationIdOf = (flowId: string, actionId: string) => `${flowId}_${actionId}`.replace(/[^A-Za-z0-9_]/g, "_");
const pathParams = (path: string): string[] => [...path.matchAll(/(?:\{([A-Za-z_][\w]*)\}|:([A-Za-z_][\w]*))/g)].map((m) => m[1] ?? m[2]);
/** `/api/orders/:id` → `/api/orders/{id}` */
export const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z_][\w]*)/g, "{$1}");

export function buildOpenApi(input: DesignDocInput, options: { title?: string; version?: string } = {}): OpenApiResult {
  const warnings: string[] = [];
  const paths: Record<string, Record<string, Json>> = {};
  const schemas: Record<string, Json> = {};
  const seenIds = new Set<string>();
  let operations = 0, skipped = 0, needsAuth = false;

  for (const f of input.flows) {
    for (const [ai, a] of f.actions.entries()) {
      const route = a.httpRoute;
      if (!route?.method || !route.path) { skipped++; continue; }
      const method = route.method.toLowerCase();
      const path = toOpenApiPath(route.path);
      if (paths[path]?.[method]) { warnings.push(`${route.method} ${route.path} が重複しています (処理フロー「${f.meta.name ?? f.meta.id}」)。最初のものだけ書き出しました`); continue; }
      const actionId = a.id ?? `action${ai + 1}`;
      let opId = operationIdOf(f.meta.id, actionId);
      for (let n = 2; seenIds.has(opId); n++) opId = `${operationIdOf(f.meta.id, actionId)}_${n}`;
      seenIds.add(opId);

      const names = new Set(pathParams(path));
      const inputs = a.inputs ?? [];
      const parameters: Json[] = [...names].map((n) => {
        const inp = inputs.find((i) => i.name === n);
        return { name: n, in: "path", required: true, schema: inp ? fieldTypeToSchema(inp.type) : { type: "string" }, ...(inp?.description ? { description: inp.description } : {}) };
      });
      const rest = inputs.filter((i) => !names.has(i.name));
      const op: Json = {
        operationId: opId,
        summary: a.name ?? actionId,
        ...((a.description ?? f.meta.description) ? { description: [a.description, f.meta.description].filter(Boolean).join("\n\n") } : {}),
        tags: [f.meta.name ?? f.meta.id],
      };
      if (method === "get" || method === "delete") {
        for (const i of rest) parameters.push({ name: i.name, in: "query", required: !!i.required, schema: fieldTypeToSchema(i.type), ...(i.description ? { description: i.description } : {}) });
      } else if (rest.length) {
        op.requestBody = {
          required: rest.some((i) => i.required),
          content: { "application/json": { schema: {
            type: "object",
            properties: Object.fromEntries(rest.map((i) => [i.name, { ...fieldTypeToSchema(i.type), ...(i.description ? { description: i.description } : {}) }])),
            ...(rest.some((i) => i.required) ? { required: rest.filter((i) => i.required).map((i) => i.name) } : {}),
          } } },
        };
      }
      if (parameters.length) op.parameters = parameters;

      const responses: Record<string, Json> = {};
      for (const r of a.responses ?? []) {
        const ct = r.contentType ?? "application/json";
        let schema: Json | undefined;
        if (r.bodySchema?.typeRef) {
          const name = r.bodySchema.typeRef.replace(/^[a-z][a-z0-9_-]*:/, "").replace(/[^A-Za-z0-9_]/g, "_");
          schemas[name] ??= { type: "object", description: `拡張の応答の型 ${r.bodySchema.typeRef} (定義は拡張側)` };
          schema = { $ref: `#/components/schemas/${name}` };
        } else if (r.bodySchema?.schema && typeof r.bodySchema.schema === "object") schema = r.bodySchema.schema as Json;
        responses[String(r.status)] = { description: r.description ?? r.when ?? r.id, ...(schema ? { content: { [ct]: { schema } } } : {}) };
      }
      if (!Object.keys(responses).length) {
        const outs = a.outputs ?? [];
        responses["200"] = outs.length
          ? { description: "成功", content: { "application/json": { schema: { type: "object", properties: Object.fromEntries(outs.map((o) => [o.name, { ...fieldTypeToSchema(o.type), ...(o.description ? { description: o.description } : {}) }])) } } } }
          : { description: "成功 (応答の定義がありません)" };
      }
      op.responses = responses;
      if (route.auth === "required") { op.security = [{ bearerAuth: [] }]; needsAuth = true; }
      else if (route.auth === "none") op.security = [];
      if ((a.requiredPermissions ?? []).length) op["x-required-permissions"] = a.requiredPermissions;
      op["x-harmony"] = { processFlowId: f.meta.id, actionId };

      (paths[path] ??= {})[method] = op;
      operations++;
    }
  }
  const document: Json = {
    openapi: "3.0.3",
    info: { title: options.title ?? input.project.name, version: options.version ?? input.version ?? "1.0.0", ...(input.project.description ? { description: input.project.description } : {}) },
    paths,
    ...(Object.keys(schemas).length || needsAuth ? { components: { ...(Object.keys(schemas).length ? { schemas } : {}), ...(needsAuth ? { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } } : {}) } } : {}),
  };
  if (operations === 0) warnings.push("HTTP の契約 (メソッドとパス) を持つ処理フローのアクションがありません");
  return { document, operations, skipped, warnings };
}
