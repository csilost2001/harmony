/**
 * externalComponentManifest.ts — 外部 React Component 読込基盤の manifest 規格と検証 (#1409 P-1)。
 *
 * 外部業務 React Component を runtime ESM import で Puck に取り込むための manifest 定義。
 * manifest 本体は workspace 内ファイル (`<dataDir>/puck-components/manifest.json`) であり、
 * グローバル schema (`schemas/v3/*.json`) ではない。
 *
 * 検証は Zod 等の外部依存を使わず、手書き type guard 方式で行う。
 * RFC #1405 シリーズ P-1。
 */

/** prop 宣言 (manifest entry の props 要素)。 */
export interface ExternalPropDecl {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  label?: string;
  default?: unknown;
  /** type === "enum" の場合の選択肢。 */
  enum?: { label: string; value: string }[];
}

/** slot 宣言 (DropZone 相当、P-3 で本格活用)。 */
export interface ExternalSlotDecl {
  name: string;
  label?: string;
}

/** engine 互換性宣言。major version の一致確認に使う。 */
export interface ExternalEngineDecl {
  react?: string;
  puck?: string;
}

/** manifest の 1 component entry。 */
export interface ExternalComponentEntry {
  /** Puck config 上の component key (workspace 内 unique)。 */
  id: string;
  /** パレット表示名。 */
  label: string;
  /** manifest.json からの相対 module path (例: "./dist/foo.mjs")。 */
  module: string;
  /** 読み込む export 名。省略時 "default"。 */
  export?: string;
  /** 部品バージョン (任意の文字列)。 */
  version: string;
  /** host との engine 互換要件 (任意)。 */
  engine?: ExternalEngineDecl;
  /** prop 宣言 (P-2 で fields 本格化、P-1 では型保持のみ)。 */
  props?: ExternalPropDecl[];
  /** slot 宣言 (P-3 で活用)。 */
  slots?: ExternalSlotDecl[];
}

/** manifest 全体。 */
export interface ExternalComponentManifest {
  schemaVersion: "1";
  components: ExternalComponentEntry[];
}

export type ValidateManifestResult =
  | { ok: true; manifest: ExternalComponentManifest }
  | { ok: false; errors: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validatePropDecl(
  prop: unknown,
  path: string,
  errors: string[],
): void {
  if (!isPlainObject(prop)) {
    errors.push(`${path}: prop はオブジェクトである必要があります`);
    return;
  }
  if (typeof prop.name !== "string" || prop.name.length === 0) {
    errors.push(`${path}.name: 必須の文字列です`);
  }
  const allowedTypes = ["string", "number", "boolean", "enum"];
  if (typeof prop.type !== "string" || !allowedTypes.includes(prop.type)) {
    errors.push(
      `${path}.type: "string" | "number" | "boolean" | "enum" のいずれかが必要です`,
    );
  }
  if (prop.label !== undefined && typeof prop.label !== "string") {
    errors.push(`${path}.label: 文字列である必要があります`);
  }
  if (prop.type === "enum") {
    if (!Array.isArray(prop.enum) || prop.enum.length === 0) {
      errors.push(`${path}.enum: type="enum" の場合は非空配列が必要です`);
    } else {
      prop.enum.forEach((opt, i) => {
        if (
          !isPlainObject(opt) ||
          typeof opt.label !== "string" ||
          typeof opt.value !== "string"
        ) {
          errors.push(
            `${path}.enum[${i}]: { label: string; value: string } が必要です`,
          );
        }
      });
    }
  }
}

function validateSlotDecl(
  slot: unknown,
  path: string,
  errors: string[],
): void {
  if (!isPlainObject(slot)) {
    errors.push(`${path}: slot はオブジェクトである必要があります`);
    return;
  }
  if (typeof slot.name !== "string" || slot.name.length === 0) {
    errors.push(`${path}.name: 必須の文字列です`);
  }
  if (slot.label !== undefined && typeof slot.label !== "string") {
    errors.push(`${path}.label: 文字列である必要があります`);
  }
}

function validateEngineDecl(
  engine: unknown,
  path: string,
  errors: string[],
): void {
  if (!isPlainObject(engine)) {
    errors.push(`${path}: engine はオブジェクトである必要があります`);
    return;
  }
  if (engine.react !== undefined && typeof engine.react !== "string") {
    errors.push(`${path}.react: 文字列である必要があります`);
  }
  if (engine.puck !== undefined && typeof engine.puck !== "string") {
    errors.push(`${path}.puck: 文字列である必要があります`);
  }
}

function validateEntry(
  entry: unknown,
  index: number,
  seenIds: Set<string>,
  errors: string[],
): void {
  const path = `components[${index}]`;
  if (!isPlainObject(entry)) {
    errors.push(`${path}: entry はオブジェクトである必要があります`);
    return;
  }
  if (typeof entry.id !== "string" || entry.id.length === 0) {
    errors.push(`${path}.id: 必須の文字列です`);
  } else {
    if (seenIds.has(entry.id)) {
      errors.push(`${path}.id: id "${entry.id}" が重複しています`);
    }
    seenIds.add(entry.id);
  }
  if (typeof entry.label !== "string" || entry.label.length === 0) {
    errors.push(`${path}.label: 必須の文字列です`);
  }
  if (typeof entry.module !== "string" || entry.module.length === 0) {
    errors.push(`${path}.module: 必須の文字列です`);
  }
  if (typeof entry.version !== "string" || entry.version.length === 0) {
    errors.push(`${path}.version: 必須の文字列です`);
  }
  if (entry.export !== undefined && typeof entry.export !== "string") {
    errors.push(`${path}.export: 文字列である必要があります`);
  }
  if (entry.engine !== undefined) {
    validateEngineDecl(entry.engine, `${path}.engine`, errors);
  }
  if (entry.props !== undefined) {
    if (!Array.isArray(entry.props)) {
      errors.push(`${path}.props: 配列である必要があります`);
    } else {
      entry.props.forEach((p, i) =>
        validatePropDecl(p, `${path}.props[${i}]`, errors),
      );
    }
  }
  if (entry.slots !== undefined) {
    if (!Array.isArray(entry.slots)) {
      errors.push(`${path}.slots: 配列である必要があります`);
    } else {
      entry.slots.forEach((s, i) =>
        validateSlotDecl(s, `${path}.slots[${i}]`, errors),
      );
    }
  }
}

/**
 * 外部 component manifest を検証する。
 * 必須 field 欠落 / 型不正 / id 重複を検出し、すべての違反を errors に列挙する。
 */
export function validateExternalComponentManifest(
  input: unknown,
): ValidateManifestResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ["manifest はオブジェクトである必要があります"] };
  }

  if (input.schemaVersion !== "1") {
    errors.push(`schemaVersion: "1" である必要があります (got ${JSON.stringify(input.schemaVersion)})`);
  }

  if (!Array.isArray(input.components)) {
    errors.push("components: 配列である必要があります");
    return { ok: false, errors };
  }

  const seenIds = new Set<string>();
  input.components.forEach((entry, i) =>
    validateEntry(entry, i, seenIds, errors),
  );

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, manifest: input as unknown as ExternalComponentManifest };
}
