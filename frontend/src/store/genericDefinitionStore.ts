import type {
  GenericDefinition,
  GenericDefinitionKind,
  GenericDefinitionSummary,
  GenericDefinitionTarget,
} from "../types/v3";

function kindSchemaRef(kind: GenericDefinitionKind): string {
  return `../../schemas/v3/generic-definitions/${kind}.v3.schema.json`;
}

export interface GenericDefinitionStorageBackend {
  listAll(kind: GenericDefinitionKind): Promise<unknown[]>;
  load(kind: GenericDefinitionKind, name: string): Promise<unknown>;
  save(kind: GenericDefinitionKind, name: string, data: unknown): Promise<void>;
  delete(kind: GenericDefinitionKind, name: string): Promise<void>;
}

let _backend: GenericDefinitionStorageBackend | null = null;

export function setGenericDefinitionStorageBackend(b: GenericDefinitionStorageBackend | null): void {
  _backend = b;
}

function requireBackend(): GenericDefinitionStorageBackend {
  if (!_backend) {
    throw new Error("genericDefinitionStore: backend が初期化されていません (wsBridge 未接続)");
  }
  return _backend;
}

function toSummary(raw: unknown): GenericDefinitionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.kind !== "string" || typeof d.name !== "string" || typeof d.purpose !== "string") {
    return null;
  }
  return {
    kind: d.kind as GenericDefinitionKind,
    name: d.name as string,
    purpose: d.purpose as string,
    targets: Array.isArray(d.targets) ? (d.targets as GenericDefinitionTarget[]) : [],
    fieldCount: Array.isArray(d.fields) ? d.fields.length : 0,
  };
}

export async function listGenericDefinitions(kind: GenericDefinitionKind): Promise<GenericDefinitionSummary[]> {
  const all = await requireBackend().listAll(kind);
  return all.map(toSummary).filter((s): s is GenericDefinitionSummary => s !== null);
}

export async function loadGenericDefinition(
  kind: GenericDefinitionKind,
  name: string,
): Promise<GenericDefinition | null> {
  return (await requireBackend().load(kind, name)) as GenericDefinition | null;
}

export async function saveGenericDefinition(definition: GenericDefinition): Promise<void> {
  const toSave: GenericDefinition = {
    ...definition,
    $schema: kindSchemaRef(definition.kind),
  };
  await requireBackend().save(definition.kind, definition.name, toSave);
}

export async function deleteGenericDefinition(kind: GenericDefinitionKind, name: string): Promise<void> {
  await requireBackend().delete(kind, name);
}

export function createGenericDefinitionTemplate(params: {
  kind: GenericDefinitionKind;
  name: string;
  purpose: string;
  responsibilities: string[];
  targets: GenericDefinitionTarget[];
}): GenericDefinition {
  return {
    $schema: kindSchemaRef(params.kind),
    kind: params.kind,
    name: params.name,
    purpose: params.purpose,
    responsibilities: params.responsibilities,
    targets: params.targets,
  };
}
