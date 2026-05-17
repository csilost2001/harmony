/**
 * v3 PageLayout 型定義 (`schemas/v3/page-layout.v3.schema.json` と 1:1 対応)
 *
 * 共通レイアウト entity (RFC #1021)。ヘッダ・サイドバー・フッタ等の region 構造を宣言し、
 * 各 region に gadget (Screen{purpose: 'gadget'}) を割り当てる。
 *
 * Screen{purpose: 'page'} が `pageLayoutId` で本 entity を参照すると、runtime 時に
 * main slot (= content slot) に Screen 本文が嵌まる。PageLayout 自体は passive
 * (横断 context や個別 handler を持たず、ガジェット間連携が必要な場合のみ
 * `processFlowId?` で orchestrator を指定)。
 *
 * 配置: `<dataDir>/page-layouts/<id>.json`
 *
 * 注意: PageLayoutEntry (一覧 UI 表示用メタ) は `harmony.ts` 側にあり、本ファイルとは別物。
 * PageLayoutEntry = harmony.json `entities.pageLayouts[]` 要素、
 * PageLayout = 本 entity 本体 (`<dataDir>/page-layouts/<id>.json`)。
 *
 * 参考: schemas/v3/page-layout.v3.schema.json
 */

import type { Authoring, EntityMeta, Uuid } from "./common";

/**
 * PageLayout 内の region (slot) 宣言。
 *
 * 予約名:
 * - `'header'` (最上部)
 * - `'sidebar'` (横)
 * - `'footer'` (最下部)
 * - `'main'` (= content slot、page Screen 本文が嵌まる位置)
 *
 * 任意追加名も許容 (例: `'breadcrumb'` / `'notification'` / `'subHeader'`)。
 * Region 識別子 pattern: `^[a-z][a-zA-Z0-9_-]*$` (camelCase / kebab-case 許容)。
 */
export interface Region {
  name: string;
  /** Region の用途説明 (例: 'グローバルナビゲーション' / '左サイドバー')。 */
  description?: string;
}

/**
 * PageLayout デザインの参照情報。
 *
 * 生 HTML/CSS (GrapesJS) または Puck Data tree (Puck) は別ファイル
 * (workspace 配下) で管理し、本 schema は参照のみ持つ。
 * `editorKind` / `cssFramework` は PageLayout 作成時に固定、以降変更不可
 * (multi-editor-puck.md 仕様準拠)。
 */
export interface PageLayoutDesign {
  /** 本 PageLayout のエディタ種別。作成時に固定、以降変更不可。 */
  editorKind: "grapesjs" | "puck";
  /** 本 PageLayout の CSS フレームワーク。作成時に固定、以降変更不可。 */
  cssFramework: "bootstrap" | "tailwind";
  /** GrapesJS デザインファイルへの相対パス (editorKind='grapesjs' のとき、例: 'design.json')。 */
  designFileRef?: string;
  /** Puck Data JSON への相対パス (editorKind='puck' のとき、例: 'puck-data.json')。 */
  puckDataRef?: string;
  /** サムネイル画像への相対パス または data URL。 */
  thumbnailRef?: string;
}

/**
 * PageLayout entity 本体 (RFC #1021)。
 * EntityMeta + region 構造 + assignments + design 参照 + 任意の ProcessFlow 紐付け。
 */
export interface PageLayout extends EntityMeta {
  $schema?: string;
  /**
   * PageLayout が宣言する region 一覧。
   * 予約名 (header / sidebar / footer / main) を含むことを推奨。
   * main は content slot として page Screen 本文が嵌まる位置。
   */
  regions: Region[];
  /**
   * region 名 → gadget Screen ID マップ。
   * 各 region に割り当てる Screen は purpose='gadget' でなければならない
   * (cross-entity validator で検証)。
   * main region は content slot として page Screen が嵌まるため
   * assignments には通常含めない (含めても loader が無視)。
   */
  assignments: Record<string, Uuid>;
  /**
   * ガジェット間連携 orchestrator として紐付ける ProcessFlow ID (optional)。
   * MVP では schema 上は枠のみ用意、実装は Phase 2 (RFC #1021 Q2=a)。
   */
  processFlowId?: Uuid;
  /**
   * PageLayout のビジュアル定義参照 (region 配置の Designer 編集対象)。
   * 生 HTML / Puck data は別ファイル参照。
   */
  design: PageLayoutDesign;
  authoring?: Authoring;
}
