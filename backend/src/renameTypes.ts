/**
 * rename (renameEntity.ts) の公開型。renameEntity.ts が再 export するので、利用側の import 先は変わらない。
 */
import type { TopLevelEntityKind } from "./projectStorage.js";

// ── Public types ────────────────────────────────────────────────────────────

/** rename 対象として許容される entity 種別 (RFC #1284、7 entity type 限定) */
export type RenameEntityType = TopLevelEntityKind;

/** 参照位置 1 件 (RFC 6901 jsonPointer + 旧値) */
export interface RefLocation {
  /** dataRoot 相対 path (例: "process-flows/order-create.json") */
  filePath: string;
  /** 参照元 entity 種別 ("processFlow" 等) */
  entityKind: string;
  /** 参照元 entity の id */
  entityId: string;
  /** 参照位置の RFC 6901 pointer (例: "/steps/0/inputs/2/tableId") */
  jsonPointer: string;
  /** 置換前の値 (= oldId) */
  oldValue: string;
}

/**
 * Phase G M-1 (Codex round 2 独立レビュー): 別 entity type に同名 entity が存在し、かつ
 * `View.dependencies[]` (untyped EntityId 配列、Table or View どちらでも可) で参照されている
 * ambiguous なケースを表す。silent data corruption を防ぐため preview / execute を block する。
 */
export interface AmbiguousDependencyRef {
  /** ambiguous dependency を抱える View の id */
  viewId: string;
  /** 対象 entity と同名の別 entity type ("table" or "view") */
  conflictingEntityType: RenameEntityType;
  /** filePath (dataRoot 相対) */
  filePath: string;
}

export interface PreviewResult {
  entityType: RenameEntityType;
  oldId: string;
  newId: string;
  /** newId が同 entity 種別内で未使用か (true なら衝突なし) */
  uniqueOk: boolean;
  /** oldId が実在するか */
  oldExists: boolean;
  /** 他 session が edit lock を保持しているか */
  lockedByOther: boolean;
  /** 主ファイル + design 等を含む rename 対象 file path 群 (dataRoot 相対) */
  fileRenames: Array<{ from: string; to: string }>;
  /** 参照側 update の全位置 */
  refUpdates: RefLocation[];
  /** refUpdates.length (UI 表示用に明示) */
  totalRefs: number;
  /**
   * Phase G M-1 (Codex round 2): cross-type ambiguous dependency が検出された View 一覧。
   * 空配列なら通常実行可。空でない場合は rename を block (execute 側で throw)。
   * UI は本配列を error として表示し、設計者に「先に同名の別 entity を rename / 削除」を促す。
   */
  ambiguousDependencies: AmbiguousDependencyRef[];
  /**
   * Phase G M-4 (Codex round 2): 参照側 entity を編集中の active EditSession が存在する場合に列挙。
   * 1 件でも入っていれば rename を block (execute 側で throw)。後続 save で rename 済 ref を
   * 巻き戻して orphan 再生成するリスクを防ぐ。
   */
  concurrentEditRefs: Array<{ entityKind: string; entityId: string; sessionId: string }>;
  /**
   * Phase H N-2 (Opus round 2 独立レビュー): rename を block せず通せるが設計者へ通知すべき
   * 状況のメッセージ列。execute はこれを理由に block しない (情報通知のみ)。
   *
   * 例:
   * - その他の非 fatal な scan warning (将来追加余地)
   *
   * Phase I round 3+4 で `screen-flow-positions` / `er-layout` の positions oldId+newId
   * 同時存在は blocker に格上げ (`positionsCollisions` 専用 field、execute throw)。
   * 旧 `warnings` 経路に乗せていた positions collision メッセージは `positionsCollisions`
   * に分離されたため、本配列には現状他の通知のみが入る (将来拡張用)。
   *
   * UI は本配列を warning として preview / 実行後 toast に表示する。
   */
  warnings: string[];
  /**
   * Phase I round 3+4 Must-fix D (3 AI 全員指摘): positions KEY (object key) に oldId と
   * newId が同時存在する場合、旧実装は KEY 移行を skip して warning 扱いで rename 成功させ
   * ていた。これは screen-flow-positions / er-layout で本来移行すべき座標 entry を orphan
   * 化させる data corruption リスクのため、blocker に格上げする。
   *
   * 空配列なら通常実行可。空でない場合は rename を block (execute 側で throw、UI dialog
   * で execute button disable + error 表示)。設計者は先に stale な positions entry を
   * 手動で除去してから rename を再実行する必要がある。
   */
  positionsCollisions: string[];
}

export interface RenameOperation {
  /** undo 用 operation id (uuid v4) */
  operationId: string;
  entityType: RenameEntityType;
  oldId: string;
  newId: string;
  /** uuid 不変保証チェック用 (rename 後 read で一致 assert) */
  uuid: string;
  /** TTL 計算用 (ms epoch) */
  ts: number;
  /**
   * TTL 期限の ms epoch (server 内の expiration 判定 / audit 用)。
   * frontend には epoch を比較させず `undoTtlMs` duration を使わせる。
   */
  ttlExpiresAt: number;
  /**
   * frontend toast の countdown 用 duration。server/client の epoch clock を混在させず、
   * response 受信時点から同じ TTL window を開始する。
   */
  undoTtlMs: number;
  /**
   * dataRoot 相対 path + 元 content (undo 時の restore 用)。
   *
   * Phase J Must-fix A (#1298 round 5 Codex M-1): `newContent` (commit 直後 read-back の bytes) と
   * `kind` を追加。旧実装は ref 側 (refUpdates) のみ byte 比較で post-update 編集を検出していたが、
   * primary / companion (design.json / puck-data.json) の事後編集を「存在検査のみ」で見逃し、
   * 「rename → 新 ID 編集 → undo」で正当な新編集を silent 破棄していた。本 phase で
   * primary + companion も byte 比較対象に拡張する。
   *
   * `kind` の意味:
   * - "primary": writeEntityById で書かれた主 entity ファイル
   * - "companion": .design.json / puck-data.json 等の raw copy
   * - "delete-only": from === to で削除のみ (legacy ProcessFlow 等、newContent は null)
   *
   * `newContent` の意味:
   * - "primary" / "companion": commit 直後 read-back の content (byte 比較期待値)
   * - "delete-only": null (期待値なし、検査 skip)
   */
  fileRenames: Array<{
    from: string;
    to: string;
    originalContent: string;
    kind: "primary" | "companion" | "delete-only";
    newContent: string | null;
  }>;
  /** ref 側 update の dataRoot 相対 path + 元 content + 新 content */
  refUpdates: Array<{ filePath: string; originalContent: string; newContent: string }>;
  /**
   * Phase I round 3+4 Should-fix SF-5 (Opus round 4): history directory rename。
   * `<root>/.edit-sessions-history/<resourceType>/<oldId>/` → `.../<newId>/` の
   * atomic rename を行った場合に記録 (undo で逆方向 rename)。
   *
   * Phase J Should-fix SF-ε (#1298 round 5 Codex S-1): Screen rename は primary + aux の
   * 3 resource type すべてで history migration を行うため、複数 entry を持ち得る配列に拡張。
   * 旧 single 形は backward compat 上 optional として残す (古い in-memory operation を undo
   * しても動作するように)。
   */
  historyMigration?: { resourceType: string; oldId: string; newId: string };
  historyMigrations?: Array<{ resourceType: string; oldId: string; newId: string }>;
  /**
   * Phase I round 3+4 Should-fix SF-4 / SF-6 (Codex S-3 / Opus SF-2): edit-sessions
   * file 内の `content.resourceId` が oldId のものを newId に書き換えた一覧。
   * undo で逆方向に書き戻すため `editSessionId` と元の `resourceId` を保持。
   *
   * Phase J Must-fix C (#1298 round 5 Codex M-3): Screen aux session も含めるため、各 entry に
   * `resourceType` を追加 (旧 entry は backward compat 上 optional)。
   */
  editSessionMigrations?: Array<{
    editSessionId: string;
    oldResourceId: string;
    newResourceId: string;
    resourceType?: string;
  }>;
}

/** rename 中 lock 検査で参照する EditSession 抽象 (テスト容易性のため最小契約) */
export interface EditSessionLike {
  state: "Active" | "Discarded";
  participants: Map<string, { sessionId: string; role: "Edit" | "View" }>;
}

export interface RenameOpts {
  /**
   * 自セッションは lock 衝突から除外する (sessionId が participants.Edit に含まれていても OK)。
   * UI から rename を実行する経路で active edit session を持っている前提に対応。
   */
  sessionId?: string;
  /**
   * lock check 用 EditSession 一覧 inject (テスト容易性 / handler 経由で bridge から取得)。
   * 省略時は lock check skip (test path / standalone path 用)。
   */
  editSessions?: ReadonlyArray<EditSessionLike>;
  /**
   * Phase G M-4 (Codex round 2): rename は ref scan で更新する参照側 entity (ProcessFlow /
   * Screen / View / Table / PageLayout / ViewDefinition 等) を committed file に直接 write
   * するため、別 session が当該 ref 側 entity を Edit 中だと後続 save で rename 済 ref を
   * 旧 id に巻き戻して orphan を再生成する。
   *
   * 本 callback は (entityKind, entityId) を受け取り、active Edit session 一覧を返す。
   * 1 件でも返れば preview に concurrentEditRefs として記録 + execute は throw する。
   * 省略時 (test path / standalone path) は ref-side lock check skip。
   *
   * entityKind は EditSessionStore の DraftResourceType 文字列で来るが、refScan が出力する
   * entityKind は本 module の internal 名 ("processFlow" / "viewDefinition" 等) のため、
   * caller (handler) 側で kebab 形式に変換して bridge を呼ぶ責務を持つ。
   */
  fetchEditSessionsForRef?: (
    entityKind: string,
    entityId: string,
  ) => ReadonlyArray<EditSessionLike>;
  /**
   * Phase J Must-fix C (#1298 round 5 Codex M-3): edit-session の live store + persisted file
   * 双方を移行する callback。
   *
   * 旧 `migrateEditSessions` は raw fs で persisted file のみを書き換えていたため、in-memory
   * `EditSessionStore.store` の session object (`resourceId`) が old のまま残り、rename 後の
   * save / take-over が old entity を再作成する data corruption を起こしていた。
   *
   * 本 callback は WsBridge.editSessionMigrateResourceId を呼び出す薄ラッパー。
   * 戻り値: 実際に更新した session 情報の配列 (undo 時の逆方向 migration 用)。
   *
   * 未指定時 (test path / standalone path) は旧 raw fs 経路 (migrateEditSessionsRawFs) に fallback。
   */
  migrateEditSessions?: (
    resourceType: string,
    oldId: string,
    newId: string,
    targetEditSessionIds?: readonly string[],
  ) => Promise<
    Array<{ editSessionId: string; oldResourceId: string; newResourceId: string }> |
    EditSessionMigrationResult
  >;
}

export interface EditSessionMigrationResult {
  migrated: Array<{ editSessionId: string; oldResourceId: string; newResourceId: string }>;
  warnings: string[];
}

