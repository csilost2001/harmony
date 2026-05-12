import React from 'react';
import { render, RenderResult } from '@testing-library/react';

/**
 * renderWithProviders — テスト用 render ラッパー
 *
 * 必要に応じて Provider (Context / Router 等) を追加する。
 * 現状はシンプルな render の薄いラッパー。
 */
export function renderWithProviders(ui: React.ReactElement): RenderResult {
  return render(ui);
}
