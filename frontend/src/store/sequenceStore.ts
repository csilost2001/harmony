import type { Sequence, SequenceEntry, SequenceId, PhysicalName, DisplayName, Timestamp } from "../types/v3";
import { generateUUID } from "../utils/uuid";
import { loadProject, saveProject } from "./flowStore";
import { renumber, nextNo } from "../utils/listOrder";

// ─── ストレージバックエンド ──────────────────────────────────────────────

export interface SequenceStorageBackend {
  loadSequence(sequenceId: string): Promise<unknown>;
  saveSequence(sequenceId: string, data: unknown): Promise<void>;
  deleteSequence(sequenceId: string): Promise<void>;
}

let _backend: SequenceStorageBackend | null = null;

export function setSequenceStorageBackend(b: SequenceStorageBackend | null): void {
  _backend = b;
}

// ─── localStorage キー (v3 名前空間、#549) ───────────────────────────────

const SEQUENCE_PREFIX = "v3-sequence-";

const SEQUENCE_SCHEMA_REF = "../../schemas/v3/sequence.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

// ─── 公開 API ────────────────────────────────────────────────────────────

/** シーケンス一覧を取得（project.json のメタ情報、v3 SequenceEntry[]） */
export async function listSequences(): Promise<SequenceEntry[]> {
  const project = await loadProject();
  return project.sequences ?? [];
}

/** シーケンス定義を読み込み */
export async function loadSequence(sequenceId: string): Promise<Sequence | null> {
  if (_backend) return (await _backend.loadSequence(sequenceId)) as Sequence | null;
  const s = localStorage.getItem(`${SEQUENCE_PREFIX}${sequenceId}`);
  if (!s) return null;
  try { return JSON.parse(s) as Sequence; } catch { return null; }
}

/** シーケンス定義を保存（project.json のメタも同期） */
export async function saveSequence(sequence: Sequence): Promise<void> {
  // $schema は spread 後に明示的に上書きして、旧 v1/v2 由来の $schema を必ず v3 ref に書き換える。
  const toSave: Sequence = { ...sequence, $schema: SEQUENCE_SCHEMA_REF, updatedAt: nowTs() };

  if (_backend) {
    await _backend.saveSequence(toSave.id, toSave);
  } else {
    localStorage.setItem(`${SEQUENCE_PREFIX}${toSave.id}`, JSON.stringify(toSave));
  }

  await syncSequenceMeta(toSave);
}

/** シーケンスを新規作成 */
export async function createSequence(
  physicalName: PhysicalName,
  name: DisplayName,
  description?: string,
): Promise<Sequence> {
  const ts = nowTs();
  const sequence: Sequence = {
    $schema: SEQUENCE_SCHEMA_REF,
    id: generateUUID() as SequenceId,
    name,
    description,
    physicalName,
    startValue: 1,
    increment: 1,
    cache: 1,
    cycle: false,
    usedBy: [],
    createdAt: ts,
    updatedAt: ts,
  };
  await saveSequence(sequence);
  return sequence;
}

/** シーケンスを削除 */
export async function deleteSequence(sequenceId: string): Promise<void> {
  if (_backend) {
    await _backend.deleteSequence(sequenceId);
  } else {
    localStorage.removeItem(`${SEQUENCE_PREFIX}${sequenceId}`);
  }

}

interface CommitSequencesDeps {
  loadProject: typeof loadProject;
  saveProject: typeof saveProject;
  deleteSequence: typeof deleteSequence;
}

export async function commitSequences(
  { itemsInOrder, deletedIds }: { itemsInOrder: SequenceEntry[]; deletedIds: string[] },
  deps: CommitSequencesDeps = { loadProject, saveProject, deleteSequence },
): Promise<void> {
  const project = await deps.loadProject();
  const deletedSet = new Set(deletedIds);
  const orderMap = new Map(itemsInOrder.map((s, i) => [s.id, i]));
  project.sequences = (project.sequences ?? [])
    .filter((s) => !deletedSet.has(s.id))
    .sort((a, b) => (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    .map((s, i) => ({ ...s, no: i + 1 }));
  await deps.saveProject(project);
  for (const id of deletedIds) {
    await deps.deleteSequence(id);
  }
}

// ─── 内部 ────────────────────────────────────────────────────────────────

async function syncSequenceMeta(sequence: Sequence): Promise<void> {
  const project = await loadProject();
  if (!project.sequences) project.sequences = [];

  const idx = project.sequences.findIndex((s) => s.id === sequence.id);
  const meta: SequenceEntry = {
    id: sequence.id,
    no: idx >= 0 ? project.sequences[idx].no : nextNo(project.sequences),
    name: sequence.name,
    physicalName: sequence.physicalName,
    conventionRef: sequence.conventionRef,
    updatedAt: sequence.updatedAt,
    maturity: sequence.maturity,
  };

  if (idx >= 0) {
    project.sequences[idx] = meta;
  } else {
    project.sequences.push(meta);
  }
  project.sequences = renumber(project.sequences);
  await saveProject(project);
}
