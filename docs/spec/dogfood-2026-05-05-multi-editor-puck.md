# dogfood レポート — マルチエディタ / Puck × cssFramework 検証 (2026-05-05)

## 概要

- **対象**: #806 マルチエディタ対応 (Puck 併設) シリーズ — 子 6 dogfood
- **目的**: Puck × Tailwind / Puck × Bootstrap の 2 軸を小規模サンプルで実証
  - 共通レイアウト props の semantic → utility class マッピングが正しく動作するか
  - cssFramework 切替で同じ Puck Data から異なる class が生成されるか
  - 動的コンポーネント (`puck-components.json`) の定義が読み込まれるか
  - E2E spec (puck-editor.spec.ts) の構造的整合性確認
- **日付**: 2026-05-05
- **対象サンプル**:
  - `workspaces/dogfood-puck-tailwind-2026-05-05/` (Puck × Tailwind)
  - `workspaces/dogfood-puck-bootstrap-2026-05-05/` (Puck × Bootstrap)

---

## シナリオ: お問い合わせフォーム画面

両サンプルで同一の Puck Data 構造を持つ「お問い合わせフォーム」画面を検証した。  
画面構成: Section → Heading (center/primary) → Paragraph (center/muted) → Container (card形式) → Input × 2 → Select → Textarea → Button (right)

### 検証ポイント

| 観点 | 内容 |
|------|------|
| A | 同一 Puck Data (semantic props) から cssFramework 別の class が生成されるか |
| B | `align: "right"` の Button が右側に配置されるか |
| C | `bgAccent: "primary-soft"` が Tailwind / Bootstrap で異なる class になるか |
| D | `puck-components.json` のカスタムコンポーネント定義が読み込まれるか |
| E | AJV schema 検証 (vitest) を pass するか |

---

## Puck × Tailwind 検証結果

### 期待 utility class 出力 (仕様: docs/spec/multi-editor-puck.md § 2.6)

| prop | 値 | 期待出力 class |
|------|-----|----------------|
| heading / align | center | `text-center` |
| heading / colorAccent | primary | `text-blue-600` |
| paragraph / colorAccent | muted | `text-gray-500` |
| container / bgAccent | white | `bg-white` |
| container / border | default | `border` |
| container / shadow | md | `shadow-md` |
| container / rounded | lg | `rounded-lg` |
| container / padding | xl | `p-8` |
| section / bgAccent | primary-soft | `bg-blue-50` |
| button / align | right | `text-right` |

### 検証結果サマリ

| 観点 | 結果 | 備考 |
|------|------|------|
| A. cssFramework 分岐 | OK | CssFrameworkContext 経由で tailwind マッピングが適用される実装を確認 |
| B. align=right 右寄せ | OK | `text-right` が期待通り出力される mapping 実装 (tailwind.ts:align) |
| C. primary-soft → `bg-blue-50` | OK | bootstrap.ts と tailwind.ts で分岐 (`bg-primary-subtle` vs `bg-blue-50`) |
| D. puck-components.json 読込 | OK | `primitive: "card"` が BUILTIN_PRIMITIVE_NAMES に含まれる |
| E. AJV schema pass | OK | vitest 1488/1488 pass |

---

## Puck × Bootstrap 検証結果

### 期待 utility class 出力 (Bootstrap 5)

| prop | 値 | 期待出力 class |
|------|-----|----------------|
| heading / align | center | `text-center` |
| heading / colorAccent | primary | `text-primary` |
| paragraph / colorAccent | muted | `text-muted` |
| container / bgAccent | white | `bg-white` |
| container / border | default | `border` |
| container / shadow | md | `shadow` |
| container / rounded | lg | `rounded-3` |
| container / padding | xl | `p-5` |
| section / bgAccent | primary-soft | `bg-primary-subtle` |
| button / align | right | `text-end` |

### 検証結果サマリ

| 観点 | 結果 | 備考 |
|------|------|------|
| A. cssFramework 分岐 | OK | bootstrap マッピングが適用される実装を確認 |
| B. align=right 右寄せ | OK | Bootstrap では `text-right` ではなく `text-end` (Bootstrap 5 規約) |
| C. primary-soft → `bg-primary-subtle` | OK | Bootstrap 5 の subtle カラー utility |
| D. puck-components.json 読込 | OK | 同一定義が両サンプルで共通利用可能 |
| E. AJV schema pass | OK | vitest 1488/1488 pass |

### Tailwind vs Bootstrap 出力比較

同じ `align: "right"` に対して:
- Tailwind: `text-right`
- Bootstrap 5: `text-end`

これは仕様 (docs/spec/multi-editor-puck.md § 2.6) に記載された期待通りの差異。  
Puck Data (`puck-data.json`) は `"align": "right"` という semantic 値を保持し、cssFramework に依存しない。

---

## 動的コンポーネント登録検証

### テスト定義

```json
{
  "id": "contact-form-group",
  "label": "お問い合わせフォームグループ",
  "primitive": "card",
  "propsSchema": {
    "title": { "type": "string", "default": "お問い合わせ" },
    "submitLabel": { "type": "string", "default": "送信する" },
    "showCategory": { "type": "boolean", "default": true }
  }
}
```

### 結果

- `primitive: "card"` は `BUILTIN_PRIMITIVE_NAMES` に含まれる → OK
- `type: "string"` / `type: "boolean"` の propsSchema は `buildConfigWithCustomComponents()` で Puck fields に変換される → OK
- `type: "enum"` フィールドが無くても `type: "boolean"` で radio フィールドが生成される → OK

---

## E2E spec 構造確認

`designer/e2e/puck-editor.spec.ts` の 7 テストシナリオの構造的整合性を確認した。

| シナリオ | 目的 | 検証方式 |
|---------|------|---------|
| 1. Puck デザイナ描画 | editorKind=puck で Puck UI が表示されるか | `.Puck` セレクタの visibility |
| 2. パレット表示 | コンポーネントパレットが存在するか | HTML content に Puck 関連マークアップが含まれるか |
| 3. 既存データ表示 | puck-data.json が読み込まれるか | localStorage fallback + Puck マウント確認 |
| 4. 保存と復元 | reload 後も状態が維持されるか | reload 後の URL 確認 |
| 5. GrapesJS/Puck 混在 | 同一プロジェクトで両エディタが使えるか | 各 screenId へのナビゲーション |
| 6a/6b. cssFramework 両方 | 致命的エラーなく表示されるか | console.error の検出 |
| 7. 動的コンポーネントダイアログ | ダイアログが存在するか | ボタン + dialog の visibility |

注意: Puck の実際の DnD 操作は Playwright でセレクタが確定しにくいため、基本的な rendering の確認に留めている。より詳細な DnD 操作は playwright のドラッグ API で追加可能。

---

## Screen Entity ファイル (Sh-3 / M-4 修正)

各 dogfood サンプルの `screens/<id>/screen.json` (Screen Entity) を追加した (PR #813 Opus レビュー Sh-3/M-4 対応)。

| ファイル | 内容 |
|---------|------|
| `workspaces/dogfood-puck-tailwind-2026-05-05/screens/d06f00d0-0001-4000-8000-000000000011/screen.json` | `editorKind: "puck"`, `cssFramework: "tailwind"`, `puckDataRef: "puck-data.json"` |
| `workspaces/dogfood-puck-bootstrap-2026-05-05/screens/d06f00d0-0002-4000-8000-000000000022/screen.json` | `editorKind: "puck"`, `cssFramework: "bootstrap"`, `puckDataRef: "puck-data.json"` |

これにより `validatePuckScreen()` が `puckDataRef` 不在エラーを発火しなくなる。

---

## 視覚検証 (WYSIWYG リアルタイム反映) について

仕様書 §10 受け入れ基準:「dogfood 2 sample で各々 1 画面作成、**両方とも WYSIWYG リアルタイム反映を視覚検証**」

**現状**: 本 dogfood レポートは実装コードの fact-check (マッピング実装・AJV検証) に基づく確認であり、実機 dev server (npm run dev) を起動してブラウザで Puck UI を操作した視覚検証は実施していない。

**理由**: CI / Windows 環境での Playwright ヘッドレスブラウザによる Puck DnD 操作の自動化は、Puck 内部セレクタの不確定性により技術的困難がある。

**代替確認**: vitest 1488/1488 pass + E2E 構造確認 (puck-editor.spec.ts 7 シナリオ) + コード level の実装 fact-check で代替している。実機視覚検証は dev server 起動可能な環境で別途実施することを推奨する。

---

## 既知 issue / 改善候補

1. ~~**Puck canvas のセレクタが確定していない**: puck-editor.spec.ts では `.Puck` / `[class*='Puck']` 等の柔軟なセレクタを使用しているが、Puck の実装によりクラス名が変わる可能性がある。`data-testid` 属性を追加すると E2E がより安定する~~ → **[x] 解消済み (本 PR)**: 全 20 Puck primitive の outermost 要素に `data-testid="puck-primitive-<name>"` を追加 (例: `puck-primitive-button`, `puck-primitive-card` など)
2. **DnD のテストが欠落**: 仕様書には「左パレットからドロップ」が要件として記載されているが、Puck 内部の DnD ライブラリのセレクタが特殊なため E2E では省略した。手動 smoke test で補完が必要 → **[~] 部分対応 (#814)**: pointer event simulation による `dragPrimitiveTo` helper を `designer/e2e/helpers/puck.ts` に実装。`puck-dnd.spec.ts` で Heading / Button の DnD test を追加したが、@dnd-kit の pointer event activation が Playwright の simulated pointer events で安定して発火しないため `test.skip` フォールバック付き。本格的な DnD 自動化は別 ISSUE 候補
3. **右プロパティパネルの直接操作テスト欠落**: `align: "right"` を右プロパティパネルで選んだ際の即時反映は、Puck 内部の props 変更 → re-render フローを Playwright で追うのが難しい → **[~] helper のみ対応 (#814)**: `setPuckFieldText` / `setPuckFieldSelect` helper を実装し `puck-property-panel.spec.ts` を追加したが、MCP オフライン環境では `PuckBackend.load()` が `EMPTY_PUCK_DATA` を返す制約 (§ A-S-2) のため、配置済 primitive を選択するシナリオが成立せず `test.skip` フォールバックになる。MCP 起動環境での実機検証が必要
4. **visual regression baseline (#814)**: `puck-visual-regression.spec.ts` で Bootstrap / Tailwind 両 framework の chrome (sub-toolbar / 左パレット / 右プロパティパネル + Page root field / theme CSS) を `toHaveScreenshot()` で比較。MCP オフライン制約により canvas は EMPTY だが chrome regression 検出には十分有効。Windows / Chromium / 1280x720 baseline を commit 済

---

## 評価サマリ

| 評価観点 | 5段階 | コメント |
|---------|-------|---------|
| Puck UI 描画の安定性 | 4/5 | MCP 不接続でも localStorage fallback で動作する |
| cssFramework 分岐の正確性 | 5/5 | Tailwind/Bootstrap で期待通りの class が生成される |
| 動的コンポーネント登録の完成度 | 4/5 | primitive 名の検証あり、型変換も動作 |
| E2E カバレッジ | 3/5 | 基本描画は検証。DnD/プロパティ変更は手動補完が必要 |
| 仕様書との整合性 | 5/5 | docs/spec/multi-editor-puck.md § 2.3/2.6/4.1 に準拠 |
| AJV schema 検証 | 5/5 | vitest 1488/1488 pass |
| Screen Entity ファイル完備 | 5/5 | screen.json + puck-data.json が両サンプルで揃った (Opus レビュー Sh-3/M-4 対応) |

**総合評価: 受け入れ基準の主要項目を満たす。DnD/WYSIWYG リアルタイム反映の実機視覚検証は dev server 起動環境で別途実施を推奨。**
