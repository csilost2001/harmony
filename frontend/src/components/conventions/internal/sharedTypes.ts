/**
 * Conventions catalog editor — 共通ローカル型定義 (#1145 Phase-5)
 *
 * msg / regex / limit は v3 型から派生する独立ローカル型として保持。
 * (Phase-5 前は ConventionsCatalogView.tsx 内に inline 定義されていた)
 */

export interface MsgEntryLocal {
  template: string;
  params?: string[];
  description?: string;
}

export interface RegexEntryLocal {
  pattern: string;
  flags?: string;
  description?: string;
}

export interface LimitEntryLocal {
  value: number;
  unit?: string;
  description?: string;
}
