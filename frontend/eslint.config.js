import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'test-results', 'playwright-report']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': ['warn', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': 'allow-with-description',
        'ts-nocheck': 'allow-with-description',
        'ts-check': false,
        minimumDescriptionLength: 3,
      }],
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'e2e/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': ['warn', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': 'allow-with-description',
        'ts-nocheck': 'allow-with-description',
        'ts-check': false,
        minimumDescriptionLength: 3,
      }],
    },
  },
  {
    files: ['e2e/helpers/**/*.ts', 'e2e/mcp/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // #1420/#1421: Puck (0.20 / @dnd-kit/dom = pointer-based DnD) の palette→iframe canvas
    // drag は 高レベルの locator.dragTo() では起動しない (固定の粗い操作で pointer sensor が
    // activate されない)。dragTo を書くと「動いたつもりで 0 件配置」の沈黙バグになる。
    //
    // スコープは Puck 系 spec + helper のみ。アプリには HTML5 native DnD (BlocksPanel /
    // DataList 並び替え / ScreenNode / ProcessFlowEditor の draggable+dataTransfer) もあり、
    // そちらは dragTo の方が正しい (page.mouse は HTML5 drag イベントを発火できず逆に失敗する)。
    // よって dragTo を e2e 全体で禁止すると正当な用途まで弾くため、pointer-based の Puck に限定する。
    files: ['e2e/puck-*.spec.ts', 'e2e/helpers/puck.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.property.name='dragTo']",
        message: 'Puck (dnd-kit, pointer-based) の drag は locator.dragTo() では起動できない (沈黙して 0 件配置)。e2e/helpers/puck.ts の dragPaletteItemToCanvas (page.mouse/CDP レシピ) を使うこと。詳細: ai-skills/test-strategy/SKILL.md「Puck の palette→canvas drag/drop を検証する唯一の方法」。',
      }],
    },
  },
  {
    // Puck の ComponentConfig.render はライブラリ側で React component として
    // 呼び出される contract だが、ESLint は object property の render callback を
    // component と判定できないため、primitive 定義に限って false positive を抑止する。
    files: ['src/puck/primitives/**/*.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
])
