/**
 * v3 ScreenLayout 型定義 (`schemas/v3/screen-layout.v3.schema.json` と 1:1 対応)
 *
 * Designer (画面フローエディタ) 専用、業務実装には不要。
 * `data/screen-layout.json` に対応。
 */

import type { Timestamp } from "./common";

/** 画面 / ScreenGroup の UI 座標。 */
export interface Position {
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** `data:image/...` の base64 サムネイル。 */
  thumbnail?: string;
  /** ScreenGroup の表示色 (`#RRGGBB`)。 */
  color?: string;
}

/** 画面遷移の handle 位置。 */
export interface TransitionLayout {
  sourceHandle?: string;
  targetHandle?: string;
}

/** 画面フロー UI 座標を集約。 */
export interface ScreenLayout {
  $schema?: string;
  /** Screen / ScreenGroup の UUID をキーとし、UI 座標を値とする。 */
  positions: Record<string, Position>;
  /** ScreenTransition の LocalId をキーとし、UI 座標 (handle 位置等) を値とする。 */
  transitions?: Record<string, TransitionLayout>;
  updatedAt: Timestamp;
}
