/**
 * conventionsStore.ts
 * 横断規約カタログの永続化ストア (v3)。
 *
 * 正本は `data/conventions/catalog.json` (単一ファイル、v3 schema は単一 root)。
 * wsBridge 経由で読み書きし、ws 未接続時は localStorage にフォールバック。
 * shape は `schemas/v3/conventions.v3.schema.json` に従う。
 */
import type { Conventions, SemVer, Timestamp } from "../types/v3";

export interface ConventionsStorageBackend {
  loadConventions(): Promise<unknown>;
  saveConventions(catalog: unknown): Promise<void>;
}

let _backend: ConventionsStorageBackend | null = null;

export function setConventionsStorageBackend(b: ConventionsStorageBackend | null): void {
  _backend = b;
}

// ─── localStorage キー (v3 名前空間、#553) ───────────────────────────────

const LS_KEY = "v3-conventions-catalog";

const CONVENTIONS_SCHEMA_REF = "../../schemas/v3/conventions.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

/** 初期カタログ (空、msg / regex / limit / 5 標準カテゴリ + role / permission / numbering / tx / externalOutcomeDefaults を空 record で持つ)。 */
export function createEmptyCatalog(): Conventions {
  return {
    $schema: CONVENTIONS_SCHEMA_REF,
    version: "1.0.0" as SemVer,
    description: "",
    updatedAt: nowTs(),
    msg: {},
    regex: {},
    limit: {},
    scope: {},
    currency: {},
    tax: {},
    auth: {},
    role: {},
    permission: {},
    db: {},
    numbering: {},
    tx: {},
    externalOutcomeDefaults: {},
  };
}

export async function loadConventions(): Promise<Conventions | null> {
  // 1. wsBridge backend (data/conventions/catalog.json) が優先
  if (_backend) {
    const data = await _backend.loadConventions();
    if (data) return data as Conventions;
  } else {
    // 2. ws 未接続なら localStorage フォールバック (テスト時の seed にも使う)
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as Conventions;
      } catch { /* ignore */ }
    }
  }
  // 3. 最終フォールバック: public/ 配下の静的ファイル (#317 以前の経路、互換用)
  //    初回起動で data/conventions/catalog.json 未生成の場合にもデフォルト規約を返す
  try {
    const r = await fetch("/conventions-catalog.json");
    if (r.ok) return await r.json() as Conventions;
  } catch { /* ignore */ }
  return null;
}

export async function saveConventions(catalog: Conventions): Promise<void> {
  // $schema は spread 後に明示的に上書きして、旧 v1/v2 由来の $schema を必ず v3 ref に書き換える。
  const toSave: Conventions = {
    ...catalog,
    $schema: CONVENTIONS_SCHEMA_REF,
    updatedAt: nowTs(),
  };
  if (_backend) {
    await _backend.saveConventions(toSave);
    return;
  }
  localStorage.setItem(LS_KEY, JSON.stringify(toSave));
}
