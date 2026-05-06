import type {
  DisplayName,
  TableId,
  Timestamp,
  ViewDefinition,
  ViewDefinitionEntry,
  ViewDefinitionId,
  ViewDefinitionKind,
} from "../types/v3";
import { generateUUID } from "../utils/uuid";
import {
  checkViewDefinitions,
  type ViewDefinitionIssue,
} from "../schemas/viewDefinitionValidator";
import { loadProject, saveProject } from "./flowStore";
import { loadAllTables } from "./tableStore";
import { renumber, nextNo } from "../utils/listOrder";

export interface ViewDefinitionStorageBackend {
  loadViewDefinition(viewDefinitionId: string): Promise<unknown>;
  listAllViewDefinitions?(): Promise<unknown[]>;
  saveViewDefinition(viewDefinitionId: string, data: unknown): Promise<void>;
  deleteViewDefinition(viewDefinitionId: string): Promise<void>;
}

let _backend: ViewDefinitionStorageBackend | null = null;

export function setViewDefinitionStorageBackend(b: ViewDefinitionStorageBackend | null): void {
  _backend = b;
}

const VIEW_DEFINITION_PREFIX = "v3-view-definition-";

const VIEW_DEFINITION_SCHEMA_REF = "../../schemas/v3/view-definition.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

// TODO(#666): Remove after ViewDefinitionId is no longer a nested brand over Uuid.
function toViewDefinitionId(id: string): ViewDefinitionId {
  return id as unknown as ViewDefinitionId;
}

// TODO(#666): Replace this local extension after FlowProject exposes viewDefinitions.
type ProjectWithViewDefinitions = Awaited<ReturnType<typeof loadProject>> & {
  viewDefinitions?: ViewDefinitionEntry[];
};

export async function listViewDefinitions(): Promise<ViewDefinitionEntry[]> {
  const project: ProjectWithViewDefinitions = await loadProject();
  return project.viewDefinitions ?? [];
}

export async function loadViewDefinition(
  viewDefinitionId: string,
): Promise<ViewDefinition | null> {
  if (_backend) {
    return (await _backend.loadViewDefinition(viewDefinitionId)) as ViewDefinition | null;
  }
  const s = localStorage.getItem(`${VIEW_DEFINITION_PREFIX}${viewDefinitionId}`);
  if (!s) return null;
  try { return JSON.parse(s) as ViewDefinition; } catch { return null; }
}

export async function loadViewDefinitionValidationMap(): Promise<
  Map<ViewDefinitionId, ViewDefinitionIssue[]>
> {
  const entries = await listViewDefinitions();
  const entryIds = new Set(entries.map((entry) => String(entry.id)));

  let viewDefinitions: ViewDefinition[];
  if (_backend?.listAllViewDefinitions) {
    const all = (await _backend.listAllViewDefinitions()) as ViewDefinition[];
    viewDefinitions = all.filter((vd) => entryIds.has(String(vd.id)));
  } else {
    viewDefinitions = (await Promise.all(entries.map((entry) => loadViewDefinition(String(entry.id)))))
      .filter((vd): vd is ViewDefinition => vd !== null);
  }

  const tables = await loadAllTables();

  const issues = checkViewDefinitions(viewDefinitions, tables);
  const validationMap = new Map<ViewDefinitionId, ViewDefinitionIssue[]>();

  for (const vd of viewDefinitions) {
    validationMap.set(toViewDefinitionId(String(vd.id)), []);
  }
  for (const issue of issues) {
    const id = toViewDefinitionId(issue.viewDefinitionId);
    validationMap.set(id, [...(validationMap.get(id) ?? []), issue]);
  }

  return validationMap;
}

export async function saveViewDefinition(vd: ViewDefinition): Promise<void> {
  const toSave: ViewDefinition = {
    ...vd,
    $schema: VIEW_DEFINITION_SCHEMA_REF,
    updatedAt: nowTs(),
  };

  if (_backend) {
    await _backend.saveViewDefinition(toSave.id, toSave);
  } else {
    localStorage.setItem(`${VIEW_DEFINITION_PREFIX}${toSave.id}`, JSON.stringify(toSave));
  }

  await syncViewDefinitionMeta(toSave);
}

export async function createViewDefinition(
  name: DisplayName,
  kind: ViewDefinitionKind,
  sourceTableId: TableId,
  description?: string,
): Promise<ViewDefinition> {
  const ts = nowTs();
  const viewDefinition: ViewDefinition = {
    $schema: VIEW_DEFINITION_SCHEMA_REF,
    id: generateUUID() as ViewDefinitionId,
    name,
    description,
    kind,
    sourceTableId,
    columns: [],
    createdAt: ts,
    updatedAt: ts,
  };
  await saveViewDefinition(viewDefinition);
  return viewDefinition;
}

export async function deleteViewDefinition(viewDefinitionId: string): Promise<void> {
  if (_backend) {
    await _backend.deleteViewDefinition(viewDefinitionId);
  } else {
    localStorage.removeItem(`${VIEW_DEFINITION_PREFIX}${viewDefinitionId}`);
  }
}

interface CommitViewDefinitionsDeps {
  loadProject: typeof loadProject;
  saveProject: typeof saveProject;
  deleteViewDefinition: typeof deleteViewDefinition;
}

export async function commitViewDefinitions(
  { itemsInOrder, deletedIds }: { itemsInOrder: ViewDefinitionEntry[]; deletedIds: string[] },
  deps: CommitViewDefinitionsDeps = { loadProject, saveProject, deleteViewDefinition },
): Promise<void> {
  const project: ProjectWithViewDefinitions = await deps.loadProject();
  const deletedSet = new Set(deletedIds);
  const orderMap = new Map(itemsInOrder.map((v, i) => [v.id, i]));
  project.viewDefinitions = (project.viewDefinitions ?? [])
    .filter((v) => !deletedSet.has(String(v.id)))
    .sort(
      (a, b) =>
        (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((v, i) => ({ ...v, no: i + 1 }));
  await deps.saveProject(project);
  for (const id of deletedIds) {
    await deps.deleteViewDefinition(id);
  }
}

async function syncViewDefinitionMeta(vd: ViewDefinition): Promise<void> {
  const project: ProjectWithViewDefinitions = await loadProject();
  if (!project.viewDefinitions) project.viewDefinitions = [];

  const idx = project.viewDefinitions.findIndex((entry) => String(entry.id) === String(vd.id));
  const meta: ViewDefinitionEntry = {
    id: toViewDefinitionId(String(vd.id)),
    no: idx >= 0 ? project.viewDefinitions[idx].no : nextNo(project.viewDefinitions),
    name: vd.name,
    kind: vd.kind,
    sourceTableId: vd.sourceTableId,
    columnCount: vd.columns?.length,
    updatedAt: vd.updatedAt,
    maturity: vd.maturity,
  };

  if (idx >= 0) {
    project.viewDefinitions[idx] = meta;
  } else {
    project.viewDefinitions.push(meta);
  }
  project.viewDefinitions = renumber(project.viewDefinitions);
  await saveProject(project);
}
