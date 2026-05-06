/// <reference types="node" />

import type { DynamicFormSchema } from "../components/common/SchemaForm";

export type ExtensionFileType = "steps" | "fieldTypes" | "triggers" | "dbOperations" | "responseTypes";

export interface StepDef {
  label: string;
  icon: string;
  description: string;
  schema: DynamicFormSchema;
}

export interface FieldTypeDef {
  kind: string;
  label: string;
}

export interface TriggerDef {
  value: string;
  label: string;
}

export interface DbOperationDef {
  value: string;
  label: string;
}

export interface ResponseTypeDef {
  description?: string;
  schema: Record<string, unknown>;
}

export interface StepsExtensionFile {
  namespace: string;
  steps: Record<string, StepDef>;
}

export interface FieldTypesExtensionFile {
  namespace: string;
  fieldTypes: FieldTypeDef[];
}

export interface TriggersExtensionFile {
  namespace: string;
  triggers: TriggerDef[];
}

export interface DbOperationsExtensionFile {
  namespace: string;
  dbOperations: DbOperationDef[];
}

export interface ResponseTypesExtensionFile {
  namespace: string;
  responseTypes: Record<string, ResponseTypeDef>;
}

export interface ExtensionsBundle {
  steps?: unknown;
  fieldTypes?: unknown;
  triggers?: unknown;
  dbOperations?: unknown;
  responseTypes?: unknown;
}

export type RawExtensionsBundle = ExtensionsBundle;

export interface LoadedExtensions {
  steps: Record<string, StepDef>;
  fieldTypes: FieldTypeDef[];
  triggers: TriggerDef[];
  dbOperations: DbOperationDef[];
  responseTypes: Record<string, ResponseTypeDef>;
}

export interface ExtensionLoadIssue {
  type: ExtensionFileType | "schema";
  code: "readError" | "invalidJson" | "schemaValidation" | "globalConflict" | "override";
  message: string;
  path?: string;
  key?: string;
}

export interface ExtensionLoadResult {
  extensions: LoadedExtensions;
  errors: ExtensionLoadIssue[];
  warnings: ExtensionLoadIssue[];
}

export interface ExtendedSchemaResult {
  schema: Record<string, unknown>;
  errors: ExtensionLoadIssue[];
  warnings: ExtensionLoadIssue[];
}

const EXTENSION_FILES: Array<{ type: ExtensionFileType; file: string }> = [
  { type: "steps", file: "steps.json" },
  { type: "fieldTypes", file: "field-types.json" },
  { type: "triggers", file: "triggers.json" },
  { type: "dbOperations", file: "db-operations.json" },
  { type: "responseTypes", file: "response-types.json" },
];

const NAMESPACE_PATTERN = /^[a-z0-9_-]*$/;
const EMPTY_EXTENSIONS: LoadedExtensions = {
  steps: {},
  fieldTypes: [],
  triggers: [],
  dbOperations: [],
  responseTypes: {},
};

const DYNAMIC_FORM_ALLOWED_KEYS = new Set([
  "type",
  "enum",
  "properties",
  "items",
  "required",
  "description",
  "default",
  "additionalProperties",
]);

export async function loadExtensionsFromDir(dir: string): Promise<ExtensionLoadResult> {
  const bundle: ExtensionsBundle = {};
  const errors: ExtensionLoadIssue[] = [];
  const fs = await import("node:fs/promises");
  let files: Set<string>;
  try {
    files = new Set(await fs.readdir(dir));
  } catch (e) {
    if (errorCode(e) === "ENOENT") {
      return loadExtensionsFromBundle(bundle);
    }
    return {
      extensions: cloneExtensions(EMPTY_EXTENSIONS),
      errors: [{
        type: "schema",
        code: "readError",
        path: dir,
        message: `拡張ディレクトリを読み込めません: ${dir}`,
      }],
      warnings: [],
    };
  }

  for (const { type, file } of EXTENSION_FILES) {
    if (!files.has(file)) continue;
    const filePath = `${dir.replace(/[\\/]$/, "")}/${file}`;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      bundle[type] = JSON.parse(raw) as unknown;
    } catch (e) {
      const code = errorCode(e);
      if (code === "ENOENT") continue;
      errors.push({
        type,
        code: code === "SYNTAX" ? "invalidJson" : "readError",
        path: filePath,
        message: `拡張ファイルを読み込めません: ${filePath}`,
      });
    }
  }

  const result = loadExtensionsFromBundle(bundle);
  return {
    extensions: result.extensions,
    errors: [...errors, ...result.errors],
    warnings: result.warnings,
  };
}

export function loadExtensionsFromBundle(bundle: ExtensionsBundle): ExtensionLoadResult {
  const extensions = cloneExtensions(EMPTY_EXTENSIONS);
  const errors: ExtensionLoadIssue[] = [];
  const warnings: ExtensionLoadIssue[] = [];

  loadSteps(bundle.steps, extensions, errors, warnings);
  loadFieldTypes(bundle.fieldTypes, extensions, errors);
  loadTriggers(bundle.triggers, extensions, errors);
  loadDbOperations(bundle.dbOperations, extensions, errors);
  loadResponseTypes(bundle.responseTypes, extensions, errors, warnings);

  return { extensions, errors, warnings };
}

export function buildExtendedSchema(
  base: object,
  extensions: LoadedExtensions,
): ExtendedSchemaResult {
  const schema = deepClone(base) as Record<string, unknown>;
  const errors: ExtensionLoadIssue[] = [];
  const warnings: ExtensionLoadIssue[] = [];
  const defs = getRecord(schema.$defs);

  mergeFieldTypes(defs, extensions.fieldTypes, errors);
  mergeEnumDef(defs, "ActionTrigger", extensions.triggers.map((t) => t.value), "triggers", errors);
  mergeEnumDef(defs, "DbOperation", extensions.dbOperations.map((op) => op.value), "dbOperations", errors);
  mergeCustomSteps(defs, extensions.steps);
  collectOverrideWarnings(defs, schema, extensions, warnings);

  return { schema, errors, warnings };
}

function loadSteps(
  raw: unknown,
  extensions: LoadedExtensions,
  errors: ExtensionLoadIssue[],
  warnings: ExtensionLoadIssue[],
): void {
  if (raw == null) return;
  const file = validateObjectFile(raw, "steps", "steps", errors);
  if (!file) return;
  const steps = getRecord(file.steps);
  if (!steps) {
    pushSchemaError(errors, "steps", "steps は object である必要があります");
    return;
  }
  const namespace = file.namespace as string;
  for (const [key, value] of Object.entries(steps)) {
    const step = validateStepDef(key, value, errors);
    if (!step) continue;
    const namespacedKey = withNamespace(namespace, key);
    if (extensions.steps[namespacedKey]) {
      warnings.push({
        type: "steps",
        code: "override",
        key: namespacedKey,
        message: `カスタムステップ ${namespacedKey} は後続定義で上書きされました`,
      });
    }
    extensions.steps[namespacedKey] = step;
  }
}

function loadFieldTypes(raw: unknown, extensions: LoadedExtensions, errors: ExtensionLoadIssue[]): void {
  if (raw == null) return;
  const file = validateObjectFile(raw, "fieldTypes", "fieldTypes", errors);
  if (!file) return;
  if (!Array.isArray(file.fieldTypes)) {
    pushSchemaError(errors, "fieldTypes", "fieldTypes は array である必要があります");
    return;
  }
  for (const item of file.fieldTypes) {
    if (isRecord(item) && typeof item.kind === "string" && item.kind && typeof item.label === "string" && item.label) {
      extensions.fieldTypes.push({ kind: item.kind, label: item.label });
    } else {
      pushSchemaError(errors, "fieldTypes", "fieldTypes の各要素は kind と label が必要です");
    }
  }
}

function loadTriggers(raw: unknown, extensions: LoadedExtensions, errors: ExtensionLoadIssue[]): void {
  if (raw == null) return;
  const file = validateObjectFile(raw, "triggers", "triggers", errors);
  if (!file) return;
  if (!Array.isArray(file.triggers)) {
    pushSchemaError(errors, "triggers", "triggers は array である必要があります");
    return;
  }
  for (const item of file.triggers) {
    if (isRecord(item) && typeof item.value === "string" && item.value && typeof item.label === "string" && item.label) {
      extensions.triggers.push({ value: item.value, label: item.label });
    } else {
      pushSchemaError(errors, "triggers", "triggers の各要素は value と label が必要です");
    }
  }
}

function loadDbOperations(raw: unknown, extensions: LoadedExtensions, errors: ExtensionLoadIssue[]): void {
  if (raw == null) return;
  const file = validateObjectFile(raw, "dbOperations", "dbOperations", errors);
  if (!file) return;
  if (!Array.isArray(file.dbOperations)) {
    pushSchemaError(errors, "dbOperations", "dbOperations は array である必要があります");
    return;
  }
  for (const item of file.dbOperations) {
    if (isRecord(item) && typeof item.value === "string" && item.value && typeof item.label === "string" && item.label) {
      extensions.dbOperations.push({ value: item.value, label: item.label });
    } else {
      pushSchemaError(errors, "dbOperations", "dbOperations の各要素は value と label が必要です");
    }
  }
}

function loadResponseTypes(
  raw: unknown,
  extensions: LoadedExtensions,
  errors: ExtensionLoadIssue[],
  warnings: ExtensionLoadIssue[],
): void {
  if (raw == null) return;
  const file = validateObjectFile(raw, "responseTypes", "responseTypes", errors);
  if (!file) return;
  const responseTypes = getRecord(file.responseTypes);
  if (!responseTypes) {
    pushSchemaError(errors, "responseTypes", "responseTypes は object である必要があります");
    return;
  }
  const namespace = file.namespace as string;
  for (const [key, value] of Object.entries(responseTypes)) {
    if (!isRecord(value) || !isRecord(value.schema)) {
      pushSchemaError(errors, "responseTypes", `responseTypes.${key}.schema は object である必要があります`);
      continue;
    }
    if (value.description !== undefined && typeof value.description !== "string") {
      pushSchemaError(errors, "responseTypes", `responseTypes.${key}.description は string である必要があります`);
      continue;
    }
    const namespacedKey = withNamespace(namespace, key);
    if (extensions.responseTypes[namespacedKey]) {
      warnings.push({
        type: "responseTypes",
        code: "override",
        key: namespacedKey,
        message: `レスポンス型 ${namespacedKey} は後続定義で上書きされました`,
      });
    }
    extensions.responseTypes[namespacedKey] = {
      ...(value.description === undefined ? {} : { description: value.description }),
      schema: value.schema,
    };
  }
}

function validateObjectFile(
  raw: unknown,
  type: ExtensionFileType,
  bodyKey: string,
  errors: ExtensionLoadIssue[],
): Record<string, unknown> | null {
  if (!isRecord(raw)) {
    pushSchemaError(errors, type, `${bodyKey} 拡張ファイルは object である必要があります`);
    return null;
  }
  const allowed = new Set(["namespace", bodyKey]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      pushSchemaError(errors, type, `未知のプロパティです: ${key}`);
      return null;
    }
  }
  if (typeof raw.namespace !== "string") {
    pushSchemaError(errors, type, "namespace は必須の string です");
    return null;
  }
  if (!NAMESPACE_PATTERN.test(raw.namespace)) {
    pushSchemaError(errors, type, "namespace は ^[a-z0-9_-]*$ に一致する必要があります");
    return null;
  }
  if (!(bodyKey in raw)) {
    pushSchemaError(errors, type, `${bodyKey} は必須です`);
    return null;
  }
  return raw;
}

function validateStepDef(key: string, raw: unknown, errors: ExtensionLoadIssue[]): StepDef | null {
  if (!isRecord(raw)) {
    pushSchemaError(errors, "steps", `steps.${key} は object である必要があります`);
    return null;
  }
  const allowed = new Set(["label", "icon", "description", "schema"]);
  for (const prop of Object.keys(raw)) {
    if (!allowed.has(prop)) {
      pushSchemaError(errors, "steps", `steps.${key}.${prop} は未対応です`);
      return null;
    }
  }
  if (typeof raw.label !== "string" || typeof raw.icon !== "string" || typeof raw.description !== "string") {
    pushSchemaError(errors, "steps", `steps.${key} は label, icon, description が必要です`);
    return null;
  }
  if (!isRecord(raw.schema)) {
    pushSchemaError(errors, "steps", `steps.${key}.schema は object である必要があります`);
    return null;
  }
  const unsupported = findUnsupportedDynamicSchemaKey(raw.schema);
  if (unsupported) {
    pushSchemaError(errors, "steps", `steps.${key}.schema に非対応キーワードがあります: ${unsupported}`);
    return null;
  }
  return {
    label: raw.label,
    icon: raw.icon,
    description: raw.description,
    schema: raw.schema as DynamicFormSchema,
  };
}

function findUnsupportedDynamicSchemaKey(schema: Record<string, unknown>): string | null {
  for (const key of Object.keys(schema)) {
    if (!DYNAMIC_FORM_ALLOWED_KEYS.has(key)) return key;
    if (key === "additionalProperties" && typeof schema[key] !== "boolean") return key;
  }
  if (schema.properties !== undefined) {
    const props = getRecord(schema.properties);
    if (!props) return "properties";
    for (const value of Object.values(props)) {
      if (!isRecord(value)) return "properties";
      const nested = findUnsupportedDynamicSchemaKey(value);
      if (nested) return nested;
    }
  }
  if (schema.items !== undefined) {
    if (!isRecord(schema.items)) return "items";
    const nested = findUnsupportedDynamicSchemaKey(schema.items);
    if (nested) return nested;
  }
  return null;
}

function mergeFieldTypes(
  defs: Record<string, unknown> | null,
  fieldTypes: FieldTypeDef[],
  errors: ExtensionLoadIssue[],
): void {
  const fieldType = getRecord(defs?.FieldType);
  const oneOf = Array.isArray(fieldType?.oneOf) ? fieldType.oneOf : null;
  if (!oneOf) return;
  const existing = collectFieldTypeKinds(oneOf);
  const added = new Set<string>();
  for (const def of fieldTypes) {
    if (existing.has(def.kind) || added.has(def.kind)) {
      errors.push({
        type: "fieldTypes",
        code: "globalConflict",
        key: def.kind,
        message: `FieldType "${def.kind}" はグローバルスキーマまたは拡張内で既に定義されています`,
      });
      continue;
    }
    oneOf.push({
      type: "object",
      required: ["kind"],
      additionalProperties: false,
      properties: {
        kind: { const: def.kind },
      },
      title: def.label,
    });
    added.add(def.kind);
  }
}

function mergeEnumDef(
  defs: Record<string, unknown> | null,
  defName: string,
  values: string[],
  type: ExtensionFileType,
  errors: ExtensionLoadIssue[],
): void {
  const def = getRecord(defs?.[defName]);
  const enumValues = Array.isArray(def?.enum) ? def.enum : null;
  if (!enumValues) return;
  const existing = new Set(enumValues.filter((v): v is string => typeof v === "string"));
  const added = new Set<string>();
  for (const value of values) {
    if (existing.has(value) || added.has(value)) {
      errors.push({
        type,
        code: "globalConflict",
        key: value,
        message: `${defName} "${value}" はグローバルスキーマまたは拡張内で既に定義されています`,
      });
      continue;
    }
    enumValues.push(value);
    added.add(value);
  }
}

function mergeCustomSteps(defs: Record<string, unknown> | null, steps: Record<string, StepDef>): void {
  const step = getRecord(defs?.Step);
  const nonReturnStep = getRecord(defs?.NonReturnStep);
  const stepOneOf = Array.isArray(step?.oneOf) ? step.oneOf : null;
  const nonReturnStepOneOf = Array.isArray(nonReturnStep?.oneOf) ? nonReturnStep.oneOf : null;
  if (!stepOneOf) return;

  for (const [type, definition] of Object.entries(steps)) {
    const customStep = buildCustomStepSchema(type, definition.schema as Record<string, unknown>);
    stepOneOf.push(customStep);
    nonReturnStepOneOf?.push(deepClone(customStep));
  }
}

function buildCustomStepSchema(type: string, schema: Record<string, unknown>): Record<string, unknown> {
  const extensionProperties = getRecord(schema.properties) ?? {};
  const extensionRequired = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];

  return {
    type: "object",
    required: Array.from(new Set(["id", "type", "description", ...extensionRequired])),
    additionalProperties: schema.additionalProperties === true,
    properties: {
      id: true,
      description: true,
      note: true,
      notes: true,
      maturity: true,
      runIf: true,
      outputBinding: true,
      txBoundary: true,
      transactional: true,
      compensatesFor: true,
      externalChain: true,
      subSteps: true,
      requiredPermissions: true,
      sla: true,
      type: { const: type },
      ...extensionProperties,
    },
  };
}

function collectOverrideWarnings(
  defs: Record<string, unknown> | null,
  schema: Record<string, unknown>,
  extensions: LoadedExtensions,
  warnings: ExtensionLoadIssue[],
): void {
  const stepType = getRecord(defs?.StepType);
  const globalSteps = new Set((Array.isArray(stepType?.enum) ? stepType.enum : []).filter((v): v is string => typeof v === "string"));
  for (const key of Object.keys(extensions.steps)) {
    if (globalSteps.has(key)) {
      warnings.push({
        type: "steps",
        code: "override",
        key,
        message: `カスタムステップ ${key} はグローバル StepType と同名のため上書き扱いです`,
      });
    }
  }

  const baseResponseTypes = getRecord((schema as { responseTypes?: unknown }).responseTypes);
  // baseSchema.responseTypes はグローバルスキーマに未追加 (#445 で導入予定)。
  // それまでは responseTypes 上書き warning は発火しない (intentional)。
  if (!baseResponseTypes) return;
  for (const key of Object.keys(extensions.responseTypes)) {
    if (key in baseResponseTypes) {
      warnings.push({
        type: "responseTypes",
        code: "override",
        key,
        message: `レスポンス型 ${key} は既存定義を上書きします`,
      });
    }
  }
}

function collectFieldTypeKinds(oneOf: unknown[]): Set<string> {
  const kinds = new Set<string>();
  for (const item of oneOf) {
    const schema = getRecord(item);
    const enumValues = Array.isArray(schema?.enum) ? schema.enum : null;
    if (enumValues) {
      enumValues.forEach((v) => {
        if (typeof v === "string") kinds.add(v);
      });
    }
    const properties = getRecord(schema?.properties);
    const kind = getRecord(properties?.kind);
    if (typeof kind?.const === "string") kinds.add(kind.const);
  }
  return kinds;
}

function withNamespace(namespace: string, key: string): string {
  return namespace ? `${namespace}:${key}` : key;
}

function pushSchemaError(errors: ExtensionLoadIssue[], type: ExtensionFileType, message: string): void {
  errors.push({ type, code: "schemaValidation", message });
}

function cloneExtensions(source: LoadedExtensions): LoadedExtensions {
  return {
    steps: { ...source.steps },
    fieldTypes: [...source.fieldTypes],
    triggers: [...source.triggers],
    dbOperations: [...source.dbOperations],
    responseTypes: { ...source.responseTypes },
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function errorCode(e: unknown): string {
  if (e instanceof SyntaxError) return "SYNTAX";
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : "UNKNOWN";
  }
  return "UNKNOWN";
}
