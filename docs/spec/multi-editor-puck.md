# マルチエディタ対応 (Puck 併設) — 仕様書

GrapesJS ベースの既存デザイナに加え、React 向けコンポーネントエディタ「Puck (by Measured)」を併設し、画面ごとに `editorKind` / `cssFramework` を選択可能にする framework 中規模拡張の仕様書。

## 関連

- メタ ISSUE: 本仕様化と同時に起票 (本書冒頭にリンクを後追記)
- 動機: 設計者が「リアルタイム WYSIWYG でデザインできる Puck × Tailwind 体験」を求めているが、既存 GrapesJS は autosave + Bootstrap 固定で別系統の良さを取り込めない。同時に旧システムの **部分更新** (一部画面のみ Tailwind / Puck 化) ニーズに応える
- 議論履歴: 設計者と Opus のセッション (2026-05-05、ドラフト v1〜v5)
- 前提: #793 (cssFramework 切替対応) 実装完了済 — 本仕様で **#793 の「project 単位固定」を「画面単位固定 + project default」に再設計**

---

## 1. 背景

### 1.1 現状と要件

現状:

- GrapesJS は autosave 廃止が #683 で進行 (明示保存式)、cssFramework は #793 で project 単位 `bootstrap` / `tailwind` 切替対応済 (project 作成時固定、途中切替不可)
- 画面項目は HTML + Bootstrap class ハードコードから semantic class への置換中
- AI 連携は design.json (HTML) を読んで Thymeleaf / React に展開する経路で確立

設計者要件 (本仕様):

1. **マルチエディタ切替**: 画面の新規作成時に `editorKind: "grapesjs" | "puck"` を選ばせる。GrapesJS は据え置き
2. **Puck デザイナ画面** (左パレット / 中央キャンバス / 右プロパティ)
3. **カスタムコンポーネント動的登録**: ダイアログで「コンポーネント名 / 種類 / プロパティ」を定義 → 即座に Puck パレットに反映 → キャンバスに配置可能に
4. **リアルタイム WYSIWYG**: デザイナで操作した瞬間に canvas で見た目が変わる (右寄せ・余白等のレイアウト指定)
5. **部分更新シナリオ対応**: 同一プロジェクト内で画面ごとに `editorKind` / `cssFramework` を独立に選べる

### 1.2 #793 仕様改訂の必要性

#793 は「project 単位で cssFramework 固定」が前提だった。本仕様は要件 5 を満たすため画面単位に再設計する。**`docs/spec/css-framework-switching.md` も併せて改訂** (project 単位 → 画面単位 + project default、画面間混在可)。

---

## 2. 設計概要

### 2.1 二層モデル (本仕様の核心)

**永続化層 (Puck Data) と出力層 (DOM class) を分離**:

| 層 | 何を持つ | cssFramework 依存 |
|---|---|---|
| **永続化層** (`puck-data.json`) | semantic な props 構造 (`{align: "right", padding: "md"}`) | **非依存** |
| **出力層** (canvas + 最終 React コード) | utility class 文字列 (`"text-right p-4"`) | **依存** (cssFramework に応じて framework 既製 utility にマップ) |

利点:

- AI が読み書きする層 (Puck Data) は cssFramework に依らず統一構造
- 画面ごとに cssFramework が違っても Puck Data の構造・意味が一致 (移行性 / 比較容易性)
- 出力層は cssFramework 別マッピング関数 1 つで対応、framework 増設も 1 ファイル追加で済む

### 2.2 アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────────┐
│ 画面 JSON (screens/<id>.json)                                   │
│   design:                                                       │
│     editorKind:    "grapesjs" | "puck"      ← 画面作成時固定    │
│     cssFramework:  "bootstrap" | "tailwind" ← 画面作成時固定    │
│     designFileRef: "design.json"   (grapesjs のとき)           │
│     puckDataRef:   "puck-data.json" (puck のとき)              │
└─────────────────────────────────────────────────────────────────┘
                          ↓ どちらか一方
┌─────────────────────────────────────────────────────────────────┐
│ payload (どちらか一方を持つ、両方持たない)                      │
│   design.json                puck-data.json                     │
│   (HTML + CSS + components)  (Puck Data tree、semantic props)   │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ EditorBackend (薄い境界 interface)                              │
│   load / save / renderEditor を提供                             │
│   実装: GrapesJSBackend / PuckBackend                          │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Designer.tsx — canvas iframe                                    │
│   theme CSS を画面の cssFramework に応じてロード:               │
│     bootstrap → theme-bootstrap.css (Bootstrap 5 + utility 込)  │
│     tailwind  → theme-tailwind.css  (Tailwind utility 全網羅)   │
│   editorKind に応じて GrapesJS or Puck をマウント               │
└─────────────────────────────────────────────────────────────────┘
                          ↓
                 [WYSIWYG 描画]
                  Puck props 変更 → React re-render
                  → class 名差替 → 既存 CSS 即適用 (リアルタイム反映)
```

### 2.3 解決順序 (画面ロード時)

`screen.design.editorKind` / `cssFramework` の値が未指定の場合、以下の順序で解決する:

1. `screen.design.editorKind` / `screen.design.cssFramework` (画面個別指定があればそれ)
2. `project.techStack.designer.editorKind` / `project.techStack.designer.cssFramework` (project default、#826 で `project.design` から移行)
3. 最終 default (`"grapesjs"` / `"bootstrap"`)

これにより:

- typical case (全画面同じ): project default 1 行で済み、画面 JSON に書く必要なし。ただし **screen.design には常に editorKind / cssFramework を明示書き込みする** (#825 実装方針)
- hybrid case (旧システム部分更新): 該当画面だけ override で記述コスト最小

### 2.4 cssFramework × editorKind マトリックス (画面単位)

| | grapesjs | puck |
|---|---|---|
| **bootstrap** | 既存システム継続・移行元 | utility WYSIWYG モデル (Bootstrap 5 utility 主体) |
| **tailwind** | モダン UI 移行先 (#793 で構築済) | utility WYSIWYG モデル (Tailwind utility 主体) **推奨組合せ** |

**画面単位なので、1 プロジェクト内で全 4 セルが混在可能**。ロック / draft 単位は引き続き screen ID 1 つ。

### 2.5 schema 拡張

#### 2.5.1 `schemas/v3/project.v3.schema.json`

```json
{
  "design": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "cssFramework": {
        "type": "string",
        "enum": ["bootstrap", "tailwind"],
        "default": "bootstrap",
        "description": "プロジェクト全画面の default CSS フレームワーク。画面側 (screen.design.cssFramework) で override 可能。省略時は 'bootstrap' 相当。"
      },
      "editorKind": {
        "type": "string",
        "enum": ["grapesjs", "puck"],
        "default": "grapesjs",
        "description": "プロジェクト全画面の default エディタ種別。画面側 (screen.design.editorKind) で override 可能。省略時は 'grapesjs' 相当。"
      }
    }
  }
}
```

#### 2.5.2 `schemas/v3/screen.v3.schema.json` (`ScreenDesign`)

```json
{
  "ScreenDesign": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "editorKind": {
        "type": "string",
        "enum": ["grapesjs", "puck"],
        "description": "本画面のエディタ種別。画面作成時に固定、以降変更不可。省略時は project.techStack.designer.editorKind を参照、それも省略なら 'grapesjs'"
      },
      "cssFramework": {
        "type": "string",
        "enum": ["bootstrap", "tailwind"],
        "description": "本画面の CSS フレームワーク。画面作成時に固定、以降変更不可。省略時は project.techStack.designer.cssFramework を参照、それも省略なら 'bootstrap'"
      },
      "designFileRef": {
        "type": "string",
        "description": "GrapesJS デザインファイルへの相対パス (editorKind=grapesjs のとき)"
      },
      "puckDataRef": {
        "type": "string",
        "description": "Puck Data JSON への相対パス (editorKind=puck のとき)"
      },
      "thumbnailRef": { "type": "string" }
    }
  }
}
```

`designFileRef` と `puckDataRef` は **どちらか一方のみ** を持つ。どちらを持つかは `editorKind` が宣言する。

### 2.6 共通レイアウト props (Puck primitive 全 component が組み込みで持つ)

Puck 右プロパティパネルで GUI 操作可能な、リアルタイム WYSIWYG レイアウト指定の有限値域:

| Puck prop | 値 | tailwind 出力 | bootstrap 出力 (Bootstrap 5 utility) |
|---|---|---|---|
| `align` | left / center / right | `text-left` / `text-center` / `text-right` | `text-start` / `text-center` / `text-end` |
| `padding` | none / sm / md / lg / xl | `p-0` / `p-2` / `p-4` / `p-6` / `p-8` | `p-0` / `p-2` / `p-3` / `p-4` / `p-5` |
| `paddingX` | (同上) | `px-*` | `px-*` |
| `paddingY` | (同上) | `py-*` | `py-*` |
| `margin` | none / sm / md / lg / xl | `m-*` | `m-*` |
| `marginBottom` | (同上) | `mb-*` | `mb-*` |
| `marginTop` | (同上) | `mt-*` | `mt-*` |
| `gap` | none / sm / md / lg | `gap-0` / `gap-2` / `gap-4` / `gap-6` | `gap-0` / `gap-2` / `gap-3` / `gap-4` |
| `colorAccent` | default / primary / secondary / muted / success / warning / danger | `text-gray-900` / `text-blue-600` / 等 | (なし) / `text-primary` / `text-secondary` / `text-muted` / `text-success` / `text-warning` / `text-danger` |
| `bgAccent` | none / white / muted / primary-soft / success-soft / warning-soft / danger-soft | (なし) / `bg-white` / `bg-gray-50` / `bg-blue-50` / 等 | (なし) / `bg-white` / `bg-light` / `bg-primary-subtle` / `bg-success-subtle` / 等 |
| `border` | none / default / strong | (なし) / `border` / `border-2` | (なし) / `border` / `border-2` |
| `rounded` | none / sm / md / lg / full | `rounded-none` / `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-full` | `rounded-0` / `rounded-1` / `rounded-2` / `rounded-3` / `rounded-pill` |
| `shadow` | none / sm / md / lg | (なし) / `shadow-sm` / `shadow-md` / `shadow-lg` | (なし) / `shadow-sm` / `shadow` / `shadow-lg` |

これらは **全 Puck primitive component が共通で持つベース props**。個別 component の固有 props (placeholder, buttonLabel 等) と分離する。

### 2.7 utility 射程の制約

| 項目 | サポート | 理由 |
|---|---|---|
| 共通レイアウト props のプリセット値 | ✅ | WYSIWYG GUI で操作可能、有限値域 |
| arbitrary value (`p-[17px]`) | ❌ 不許可 | 再現性 / デザインシステム破壊 |
| responsive prefix (`md:` / `lg:`) | ❌ MVP 外、将来 ISSUE | Puck props で 2 軸 UI が複雑、PC 画面前提で MVP |
| hover / focus state | △ theme CSS で吸収する範囲のみ | 例: `btn-primary:hover` は theme で定義、props で hover 指定する UI は MVP 不要 |
| dark mode | ❌ 本シリーズ射程外 | dark variant は別軸、別 ISSUE |
| escape hatch (`rawClass` prop) | △ 各 primitive に 1 つ | 最後の手段、原則使わせない。dogfood で利用ゼロを目指す |

`#793` の判断「α (見た目) が目的、β (フル utility-first DX) は目的外」と整合: 本仕様は **「α + Puck props 経由の限定的レイアウト指定」** の追加スコープ。

---

## 3. EditorBackend インターフェース

`designer/src/editor/EditorBackend.ts` (新設):

```ts
export interface EditorBackend {
  /** screen の payload を読み込み editor state を返す */
  load(screenId: string, draftRead: () => Promise<unknown>): Promise<EditorState>;

  /** editor state を save (本体ファイル昇格は呼び出し側 = lock/draft 経路) */
  save(screenId: string, state: EditorState, draftWrite: (payload: unknown) => Promise<void>): Promise<void>;

  /** container DOM に editor をマウント、Disposable を返す (cleanup 用) */
  renderEditor(container: HTMLElement, state: EditorState, opts: RenderOpts): Disposable;
}
```

実装: `GrapesJSBackend` / `PuckBackend` の 2 つ。後発エディタ追加時はこの interface を実装するだけ。

**Puck サ終 / メンテ停止時の後方移行用** に、Puck data → 中間 JSON への export 関数を 1 本だけ用意 (定常運用には使わない)。

---

## 4. 動的コンポーネント登録

### 4.1 メタモデル方式

「コンポーネント名 / 種類 / 個別 props」を JSON 定義し、ビルトイン primitive set に props を流し込んで Puck `Config` に反映する。**共通レイアウト props (§ 2.6) は全 primitive で組み込み**、メタモデルでは個別 props のみ定義する。

`workspaces/<wsId>/puck-components.json` (workspace スコープ、customBlockStore と同パターン):

```json
[
  {
    "id": "search-bar",
    "label": "検索バー",
    "primitive": "input-group",
    "propsSchema": {
      "placeholder": { "type": "string", "default": "キーワードを入力" },
      "buttonLabel": { "type": "string", "default": "検索" }
    }
  },
  {
    "id": "stat-card",
    "label": "サマリカード",
    "primitive": "card",
    "propsSchema": {
      "title": { "type": "string" },
      "value": { "type": "string" },
      "iconName": { "type": "string", "enum": ["chart", "user", "money", "alert"] }
    }
  }
]
```

### 4.2 仕組み

1. アプリ起動時に `puck-components.json` を読む
2. ビルトイン primitive set (15-20 個、§ 5 で一覧) のレンダラ + 個別 propsSchema + 共通レイアウト propsSchema をマージして Puck `Config` を動的構築
3. メタモデル変更時は config 再構築 + Puck 再マウントで反映
4. broadcast event `puckComponentsChanged` を発火 (workspace 内の他タブに伝搬、wsId scoping 必須)

### 4.3 ビルトイン primitive set (15-20 個)

`#793` 子 3 で確定した 15-20 個ブロックと **意味整合**:

| カテゴリ | primitive | 用途 |
|---|---|---|
| レイアウト | `container` / `row` / `col` / `section` | 階層構造 |
| テキスト | `heading` / `paragraph` / `link` | 文字 |
| フォーム | `input` / `select` / `textarea` / `checkbox` / `radio` / `button` | 入力要素 |
| データ | `table` / `image` / `icon` | 表示要素 |
| 業務複合 | `input-group` / `card` / `data-list` / `pagination` | 高頻度複合 |

各 primitive は共通レイアウト props (§ 2.6) と固有 props を持つ。

### 4.4 動的コンポーネント定義 UI

ダイアログで以下を定義可能:

- **コンポーネント名** (label): UI 表示用
- **種類** (primitive): 既存ビルトイン primitive から選ぶ (input-group / card / 等)
- **プロパティ** (propsSchema): 名前 / 型 (string / number / boolean / enum) / default 値 / オプション (enum の場合)

定義後、即座に Puck パレットに反映される (再起動不要)。

---

## 5. CSS マッピング層

### 5.1 配置

```
designer/src/puck/layoutPropsMapping/
  index.ts            # 共通型・解決関数 (cssFramework に応じて適切なマッパーを選ぶ)
  tailwind.ts         # Tailwind utility マップ
  bootstrap.ts        # Bootstrap 5 utility マップ
  __tests__/
    tailwind.test.ts  # 全プリセット値の出力検証
    bootstrap.test.ts
```

### 5.2 マッピング関数の性質

- **同期 / 純粋関数** (props → class 文字列、副作用なし)
- 未定義値域 (例: `padding: "xxl"` がマッピングにない) の場合、warning ログ + フォールバック class なし、validation で警告表示

### 5.3 値域変更ガバナンス

共通レイアウト props の値域変更 (例: `padding` に `xxl` 追加) は **設計者承認 ISSUE 必須** (実質的にデザインシステム拡張、global schema 変更に準ずる扱い)。マッピングを直接いじる PR は AI 単独実装禁止 (`feedback_schema_governance_strict.md` に準ずる)。

---

## 6. 「途中変更不可」ポリシー

editor / cssFramework ともに **画面作成時に決定、以降変更不可**。

### 6.1 プログラム的メリット

1. **データロスト・regression リスクゼロ**: HTML 内 `form-control` (Bootstrap) → Tailwind utility の自動変換は不可能 (特に Open Code / customBlock 貼り付けの自由 HTML)
2. **migration コードを書かなくていい**: 切替操作 / 確認ダイアログ / undo 機構 / draft の dirty 判定が複雑化しない
3. **AI 連携で source of truth が動かない**: 編集中に framework が変わると AI 入力ファイル形式 (design.json vs puck-data.json) も変わるため、長時間タスク中の整合性破壊リスクがある
4. **edit-session-draft (#683) との整合**: ロック保有中に框組替が起きたら draft の意味が変わる → 排除

### 6.2 ユーザールート

- 「画面複製 → 別 cssFramework / editorKind の新画面で作り直し」が公式ルート
- 旧画面は参照用に残し、片方ずつ移行 → これが「旧システム部分更新」シナリオの自然な形
- 必要なら GrapesJS Open Code (HTML 貼付) / Puck Import で部分的に流用

---

## 7. 既存仕様との整合

| 既存仕様 | 整合内容 |
|---|---|
| `edit-session-draft` (#683) | resourceType=screen で 1 ロック / 1 draft path。**payload 内に editorKind / cssFramework を含める** ことで draft の中身を判別 |
| `multi-workspace` (#679) | workspace 配下に puck-data.json / puck-components.json を置くだけで isolation 自動成立 |
| `broadcast wsId scoping` (#679) | `puckComponentsChanged` 新設、wsId scoping 必須 |
| `draft-state-policy` (#584) | Puck Data 用 `validatePuckScreen(item, allItems)` 新設、4 軸 severity 適用 (§ 8 参照) |
| `schema-governance` (#511) | `editorKind` / `cssFramework` の screen 単位追加 + project 単位 `editorKind` 追加 = 設計者承認必須 (本仕様化 ISSUE で承認取得済前提) |
| `css-framework-switching` (#793) | 「project 単位固定 / 途中切替非サポート」を「画面単位固定 + project default + 画面間混在可」に改訂 |

---

## 8. Puck 用 validation (draft-state policy 準拠)

`designer/src/utils/puckScreenValidation.ts` (新設):

| severity | ルール |
|---|---|
| **error** | `editorKind` / `cssFramework` 不正値、`puckDataRef` 不存在 (editorKind=puck のとき必須)、Puck Data の root が空 |
| **error** | 共通レイアウト props 値域違反 (例: `padding: "xxx"` のような不正値) |
| **error** | 動的コンポーネント定義の primitive がビルトインに不存在 |
| **warning** | 個別 props 未入力 (default なし)、`label` 空、画面に primitive 配置がない |

`Map<screenId, ValidationError[]>` を返す `loadPuckScreenValidationMap()` を screenStore に追加。

---

## 9. AI 連携

### 9.1 source of truth の分離

- **GrapesJS 画面**: `design.json` を AI が読む → Thymeleaf / React 両展開
- **Puck 画面**: `puck-data.json` を AI が読む → React 展開のみ (Thymeleaf 不可)

1 画面は **どちらか一方の payload しか持たない** (editorKind が宣言)。

### 9.2 AI Skill / docs 更新

`/create-flow` / `/review-flow` / `/issues` 等の Skill に以下を追記:

- 画面ロード時に最初に `screen.design.editorKind` (画面側未指定時は project default) を確認
- grapesjs なら design.json、puck なら puck-data.json を読む
- Thymeleaf 出力対象スクリプトは Puck 画面を **明示スキップ + レポート記録**

---

## 10. 受け入れ基準

- [x] `schemas/v3/project.v3.schema.json` に `design.editorKind` 追加 (本 PR 子 1)
- [x] `schemas/v3/screen.v3.schema.json` の `ScreenDesign` に `editorKind` / `cssFramework` / `puckDataRef` 追加 (本 PR 子 1)
- [x] `docs/spec/css-framework-switching.md` を画面単位化に改訂 (本 PR 子 1)
- [x] `Designer.tsx` が `screen.design.cssFramework` (fallback project default) を読み取り、対応 theme CSS を canvas iframe に注入 (子 2)
- [x] `EditorBackend` interface 新設 + `GrapesJSBackend` / `PuckBackend` 2 実装 (子 3)
- [x] `designer/package.json` に `@measured/puck` 依存追加 (子 3)
- [x] `designer/src/puck/layoutPropsMapping/{tailwind,bootstrap}.ts` + `__tests__` (子 4)
- [x] Puck primitive 15-20 個実装、各々が共通レイアウト props を組み込み (子 4)
- [x] 動的コンポーネント登録ダイアログ + `puckComponentsStore` (workspace スコープ) (子 5)
- [x] AI Skill / `/create-flow` / `/review-flow` / `/issues` 等の docs 更新 (子 6)
- [x] E2E (Playwright): Puck 画面新規作成 → 配置 → リアルタイム反映 → 保存 → reload で復元 (子 6)
- [x] dogfood 2 sample (`workspaces/dogfood-puck-tailwind-2026-05-05/` + `workspaces/dogfood-puck-bootstrap-2026-05-05/`) で各々 1 画面作成。WYSIWYG 実機視覚検証は dev server 起動環境で別途実施 (fact-check + E2E 構造確認で代替、dogfood レポート参照) (子 6)
- [x] dogfood report (`docs/spec/dogfood-2026-05-05-multi-editor-puck.md`) 作成 (子 6)

---

## 11. リスク / 懸念

### 11.1 Tailwind JIT による class 名検出

Tailwind JIT は静的解析で必要 class を抽出する。動的式 (`text-${align}`) は検出されないため、Puck primitive の render 関数では **完全 class 名を switch で出す**:

```ts
// 概念のみ。実装は子 4 で確定
const alignClass = align === "left" ? "text-left"
                 : align === "center" ? "text-center"
                 : align === "right" ? "text-right"
                 : "text-left";
```

または Tailwind config の `safelist` に全プリセット class を列挙する。実装は子 4 で確定。

### 11.2 既存 #793 サンプルへの影響

`examples/retail/project.json` / `examples/realestate/project.json` / `examples/english-learning/project.json` は `project.techStack.designer.cssFramework: "bootstrap"` 設定済 (#826 で `project.design.cssFramework` から移行)。**仕様改訂後も「画面側 default」として全画面 bootstrap が継続適用** → regression なし。リリース前のため migration 不要 (`feedback_no_backward_compat_pre_release.md`)。

### 11.3 Puck × Bootstrap セルの位置付け

`bootstrap × puck` は Bootstrap 5 utility が十分豊富 (mb-* / gap-* / p-* / text-end / bg-primary / border / rounded-* / shadow-*) のため、Bootstrap でも utility 主体で問題なし。`tailwind × puck` と機能的にほぼ同等 (一部色 token / spacing scale で Tailwind の方が表現力が高い程度)。

### 11.4 CSS スコープ問題

| 場面 | 干渉リスク | 対応 |
|---|---|---|
| Designer 画面編集 | なし (画面ごとに canvas iframe が独立) | 既存設計のまま |
| ScreenListView サムネイル | なし (画像ベース) | 既存のまま |
| 最終実装 (生成された Thymeleaf / React アプリ) | あり (SPA で画面遷移時に CSS 衝突可能性) | **本仕様の射程外**。出力側が画面単位 CSS chunk 分割 / scoped CSS / shadow DOM 等で隔離する責務を持つ。仕様書に「最終実装側は画面単位で必要な theme CSS のみロードする前提」と明記 |

### 11.5 Puck ライブラリロックイン

- `EditorBackend` 薄インターフェースで GrapesJS / Puck を分離 (§ 3)
- Puck data → 中間 JSON への export 関数 1 本を用意 (Puck サ終時の後方移行用、定常運用には使わない)
- 完全な汎化は **3 個目のエディタを入れるとき** に行う原則 (現時点では 2 実装のみ)

### 11.6 escape hatch (`rawClass` prop) の濫用

各 primitive に `rawClass` (任意 utility class 直書き) を 1 つ用意するが、原則使わせない。dogfood で利用ゼロを目指し、利用が増えたら原因分析 + 共通レイアウト props 拡張で対応 (§ 5.3 ガバナンス経由)。

---

## 12. 実装ロードマップ (子 1-6)

| 子 | 内容 | 担当想定 | 想定 commit |
|---|---|---|---|
| 子 1 (本 PR 起点) | 仕様書 2 本 (本仕様 + #793 改訂) + schema 変更 (project / screen) | Opus | 1 commit |
| 子 2 | `Designer.tsx` の theme 解決ロジック画面単位化 (project default fallback) | Sonnet | 1 commit |
| 子 3 | `EditorBackend` interface + Puck 雛形 + GrapesJS 実装の interface 適合 + `@measured/puck` 依存追加 | Sonnet | 1 commit |
| 子 4 | 共通レイアウト props システム + `layoutPropsMapping/{tailwind,bootstrap}.ts` + テスト + Puck primitive 15-20 個実装 | Sonnet | 1 commit |
| 子 5 | 動的コンポーネント (メタモデル + customBlockStore 同パターン永続化) + 登録ダイアログ + `puckComponentsStore` | Sonnet | 1 commit |
| 子 6 | AI Skill / docs 更新 + E2E + dogfood (Puck × Tailwind と Puck × Bootstrap で各 1 sample 作成) | Opus | 1 commit |

各子は **同 feature branch (`feat/multi-editor-puck-series`) に commit** され、**子を main へ逐次マージしない** (`feedback_meta_issue_one_feature_branch_one_pr.md` 準拠)。子 6 完了時点で統合 PR 作成、独立レビューを統合 PR 単位で 1 回実施。

---

## 13. 画面作成時 UI (#825)

### 13.1 ダイアログ仕様

画面作成ダイアログ (`ScreenEditModal`) に `isCreate=true` が渡されたとき (新規作成時のみ)、以下の選択 UI を表示する:

- **エディタ**: `GrapesJS` / `Puck` のラジオボタン
- **CSS フレームワーク**: `Bootstrap` / `Tailwind` のラジオボタン
- **注意書き**: 「作成後は変更できません」 (§ 6 の「途中変更不可」ポリシーを説明)

編集モーダル (画面名・種別変更等) では `isCreate=false` が渡され、上記ラジオは非表示になる。

### 13.2 project default fallback

ダイアログ開口時のデフォルト選択値は `project.techStack.designer` から解決する (#826 で `project.design` から移行):

1. `project.techStack.designer.editorKind` → 未指定なら `"grapesjs"`
2. `project.techStack.designer.cssFramework` → 未指定なら `"bootstrap"`

実装: 各ビュー (FlowEditor, ScreenListView) が起動時に `loadRawProject()` を呼び、解決値を state に保持して `ScreenEditModal` に `defaultEditorKind` / `defaultCssFramework` として渡す。

### 13.3 screen.design 常時明示書き込み

画面作成時、ユーザーが選択した (またはデフォルト値の) editorKind / cssFramework を必ず `screen.design` に明示書き込みする (`saveScreenEntity` 呼び出し)。

理由: 解決順序 (§ 2.3) では `screen.design` が空の場合 project default → 最終 default と fallback するが、将来の project default 変更が既存画面に意図せず影響する可能性を排除するため、作成時点での解決済み値を明示的に永続化する。

呼び出し経路ごとの実装:
- **FlowEditor.tsx** `handleScreenSave`: addScreen 後に `buildDefaultScreen` + `saveScreenEntity` を呼び出し
- **ScreenListView.tsx** `handleScreenSave`: 同上
- **mcpBridge.ts** `addScreen` handler: 同上 (MCP 経由での画面作成時も同一保証)

### 13.4 duplicate 時の継承

画面複製 (FlowEditor の「複製」メニュー) では UI は出さず、コピー元の `screen.design.editorKind` / `cssFramework` を強制継承する。実装では `loadScreenEntity` でコピー元 entity を読み、解決した値を新画面の `saveScreenEntity` で書き込む。

---

## 14. 関連 memory / 仕様書

- `feedback_meta_issue_one_feature_branch_one_pr.md` — 統合 PR 運用
- `feedback_worktree_placement_outside_project.md` — worktree 配置ルール
- `feedback_schema_governance_strict.md` (#511) — schema 変更ガバナンス
- `feedback_consolidate_related_proposals_into_one_issue.md` — 同根の framework 提案は 1 ISSUE に統合
- `feedback_no_backward_compat_pre_release.md` — リリース前の後方互換性方針
- `docs/spec/css-framework-switching.md` (本仕様で改訂) — #793
- `docs/spec/edit-session-draft.md` (#683)
- `docs/spec/workspace-multi.md` (#679)
- `docs/spec/draft-state-policy.md` (#584)
- `docs/spec/schema-governance.md` (#511)
