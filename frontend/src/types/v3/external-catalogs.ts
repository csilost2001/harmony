/**
 * v3 ExternalCatalogs 型定義 (`schemas/v3/external-catalogs.v3.schema.json` と 1:1 対応)
 *
 * プロジェクト全体で共有する外部システム / AI / シークレット / 環境変数 / イベント /
 * 関数の catalog 定義。配置: `<dataDir>/catalogs/external.json` (#1142、harmony rename 完遂)。
 *
 * 1 sample (project) 内で複数 ProcessFlow が同じ provider / secret / endpoint を参照する場合、
 * 本ファイルに集約することで重複排除と一括変更を可能にする。
 * flow level (`context.catalogs.*`) と本 file の両方で同じカテゴリを定義した場合、
 * flow level が project level を override する (#939 提案 C、2026-05-08)。
 *
 * 参考: schemas/v3/external-catalogs.v3.schema.json
 */

import type { Description, EnvVarKey, EventTopic, Identifier, SemVer, Timestamp } from "./common";
import type {
  EnvVarEntry,
  EventEntry,
  ExternalSystemCatalogEntry,
  FunctionEntry,
  ModelEndpointEntry,
  SecretEntry,
} from "./process-flow";

/**
 * Project-level 共有 catalogs。
 *
 * 全 properties は optional。実プロジェクトでは利用する catalog のみ宣言すれば良い。
 * key の命名規範は process-flow level の同名 catalog と同一 (Identifier / EnvVarKey / EventTopic)。
 */
export interface ExternalCatalogs {
  $schema?: string;
  /** カタログファイル自体のバージョン (SemVer)。 */
  version?: SemVer;
  description?: Description;
  updatedAt?: Timestamp;

  /**
   * AI モデルエンドポイント catalog。
   * process-flow.v3 schema の context.catalogs.modelEndpoints と同型 (provider/model/auth/defaults/fallback)。
   * key 命名: Identifier (camelCase)。
   */
  modelEndpoints?: Record<Identifier, ModelEndpointEntry>;

  /**
   * シークレット catalog。
   * process-flow.v3 schema の context.catalogs.secrets と同型 (source/name/description)。
   * key 命名: Identifier (camelCase)。
   */
  secrets?: Record<Identifier, SecretEntry>;

  /**
   * 環境変数 catalog。
   * process-flow.v3 schema の context.catalogs.envVars と同型 (type/description/default)。
   * key 命名: EnvVarKey (UPPER_SNAKE)。
   */
  envVars?: Record<EnvVarKey, EnvVarEntry>;

  /**
   * イベント pub/sub catalog。
   * process-flow.v3 schema の context.catalogs.events と同型。
   * key 命名: EventTopic (dot.lowercase + underscore)。
   */
  events?: Record<EventTopic, EventEntry>;

  /**
   * 組み込み関数 catalog。
   * process-flow.v3 schema の context.catalogs.functions と同型。
   * key 命名: Identifier (camelCase)。
   */
  functions?: Record<Identifier, FunctionEntry>;

  /**
   * 外部システム catalog (HTTP API 等)。
   * process-flow.v3 schema の context.catalogs.externalSystems と同型。
   * key 命名: Identifier (camelCase)。
   */
  externalSystems?: Record<Identifier, ExternalSystemCatalogEntry>;
}
