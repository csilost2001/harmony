# dogfood レポート — 外部 React Component + 複合部品 通し検証 (2026-05-29)

> **📝 ステータス**: RFC #1405「外部 React Component を Puck に取り込む」シリーズ P-5 (#1413) の dogfood 検証記録。P-1〜P-4 (#1409〜#1412) で実装した基盤を、実際に scaffold → vite build した本物の業務部品で通し検証した。

## 概要

- **対象**: RFC #1405 外部 React Component 読込基盤シリーズ — P-5 (#1413)「外部 component + 複合部品の dogfood 通し検証」
- **目的**: P-1〜P-4 で個別に実装・テストした基盤を、**実 scaffold → 実 vite build した業務部品**で end-to-end に通し検証し、capability 1〜6 が連続して動作することを確認する
- **日付**: 2026-05-29
- **サンプル業務部品**: `approval-status-bar` (承認ステータス帯)
  - props: `title` (string) / `status` (enum: pending / approved / rejected)
  - slot: `content` (editable region)
  - 内部で `React.useState` を使用 (host React と同一インスタンスでないと "Invalid hook call" で落ちる → React 二重化防止の証跡に利用)
- **検証手段**: 1 ファイルの通し vitest (`frontend/src/puck/__tests__/dogfoodExternalComponents.test.tsx`、12 ケース全 green)。fixture は実 build 成果物 (.mjs) を commit して hermetic 化。

---

## capability 1〜6 逐条検証表

実証跡となる test file: `frontend/src/puck/__tests__/dogfoodExternalComponents.test.tsx`

| capability | 検証手段 (test 名 + file:line) | 結果 | 証跡 |
|---|---|---|---|
| **cap1** ローディング + React 二重化防止 | `cap1: 実 build した .mjs を loader で読み込み status=ok…` (test:96) | ✅ | 実 vite build した `.mjs` を `loadExternalComponents({ importImpl })` で実 import → `status:"ok"`。`createElement` で render し、内部 `useState` が throw せず動作 (= host React 同一インスタンス)。status バッジ「承認済み」が描画される |
| **cap2** palette カテゴリ登録 | `cap2+cap3: mergeExternalComponents で projectExternal…` (test:124) | ✅ | `config.components["approval-status-bar"]` 存在 + label「(外部) 承認ステータス帯」+ `categories.projectExternal.components` に id。base カテゴリ (layout/Container) 不変 |
| **cap3** props→fields 変換 | 同上 (test:124) | ✅ | `title` (string)→`text` field、`status` (enum)→`select` field で enum options 透過。`defaultProps` に title/status の default 集約 |
| **cap4** slot field + render-prop | `cap4(slot): content slot が slot field…` (test:163) | ✅ | `fields.content.type==="slot"`、`defaultProps.content===[]`、render-prop 注入で `content()` 内部 (`SLOT_INNER_BODY`) が描画される |
| **cap4** 複合部品 (#1412) ロード済展開 | `cap4(composite): approval-status-bar を内包する複合部品をロード済…` (test:198) | ✅ | `mergeCompositeComponents` で placeholder が `projectComposite` に登録。`expandCompositePlaceholders` で展開し、内部の `approval-status-bar` が error-card にならず残る。`collectDependencies` が `["approval-status-bar"]` を返す |
| **cap4** 複合部品 未ロード依存 | `cap4(composite): 未ロードの外部 type を内包…` (test:258) | ✅ | 外部 component を load しない config で展開すると、依存ノードが `compositeErrorTypeName` の error-card 型に差し替わり `missingType==="approval-status-bar"` |
| **cap5** project scoping | `cap5: 別 workspace の manifest を別 fetchImpl で解決…` (test:316) | ✅ | workspace A (approval-status-bar) と B (billing-summary) を別 fetchImpl で解決。互いの component が混入しない (`projectExternal.components` が各 1 件) |
| **cap5** id 衝突防御 | `cap5: 既存 built-in id と衝突する外部 component…` (test:355) | ✅ | `id:"Container"` の外部 component は built-in Container を上書きせず、別 key の `id-collision` エラーカードに落ちる |
| **cap6** manifest-invalid | `cap6: manifest-invalid (schemaVersion 不正)…` (test:395) | ✅ | `schemaVersion:"999"` → `errorKind:"manifest-invalid"` |
| **cap6** version-mismatch | `cap6: version-mismatch (engine.react=18)…` (test:407) | ✅ | `engine.react:"18"` → `version-mismatch`、import 未実行 (importSpy 未 call) |
| **cap6** missing-export | `cap6: missing-export (export 名不在)…` (test:425) | ✅ | `export:"NotExist"` を実 .mjs (default のみ export) に向ける → `missing-export` |
| **cap6** load-error (SSRF) | `cap6: load-error (module が配信範囲外 = SSRF)…` (test:441) | ✅ | `module:"https://evil.example.com/x.mjs"` → import せず `load-error`、detail に「配信範囲外」 |
| **cap6** エラーカード UX | `cap6: 各 errorKind の entry は…エラーカード化…` (test:462) | ✅ | `mergeExternalComponents` がエラー entry を `ExternalComponentErrorCard` 化、`data-error-kind` + 日本語文言「バージョン不一致」+ 部品名が表示される |

注: errorKind 網羅の細目 (404→空配列 / network throw→空配列 / `../` 脱出 / protocol-relative / 拡張子 allowlist 等) は既存 `frontend/src/puck/externalComponents.test.ts` が網羅済のため、本 dogfood は代表 4 種 (manifest-invalid / version-mismatch / missing-export / load-error(SSRF)) のみを通し検証している。

---

## 実 scaffold → install → build の実行ログ

### 1. scaffold

```
$ node scripts/scaffold/puck-component.mjs approval-status-bar --out .tmp/dogfood-puck-ext-20260529
外部 Puck Component を生成します: approval-status-bar (ApprovalStatusBar)
  生成: .tmp/dogfood-puck-ext-20260529/approval-status-bar/package.json
  生成: .tmp/dogfood-puck-ext-20260529/approval-status-bar/vite.config.ts
  生成: .tmp/dogfood-puck-ext-20260529/approval-status-bar/tsconfig.json
  生成: .tmp/dogfood-puck-ext-20260529/approval-status-bar/src/ApprovalStatusBar.tsx
  生成: .tmp/dogfood-puck-ext-20260529/approval-status-bar/manifest.json
  生成: .tmp/dogfood-puck-ext-20260529/approval-status-bar/README.md
```

生成後、`src/ApprovalStatusBar.tsx` を業務部品 (承認ステータス帯、`status` enum + `title` + `content` slot + `useState`) に編集し、`manifest.json` を props/enum/slot に合わせて編集した。

### 2. install

```
$ cd .tmp/dogfood-puck-ext-20260529/approval-status-bar && npm install
added 85 packages, and audited 86 packages in 13s
```

### 3. build (vite lib build、react/react-dom/@measured/puck external)

```
$ npm run build
> @harmony-external/approval-status-bar@0.1.0 build
> vite build

vite v6.4.2 building for production...
transforming...
✓ 1 modules transformed.
rendering chunks...
computing gzip size...
dist/approval-status-bar.mjs  2.37 kB │ gzip: 0.93 kB
✓ built in 50ms
```

build 成果物 `dist/approval-status-bar.mjs` の冒頭 (react が bundle されず import = external 化されている証跡):

```js
import { jsxs as o, jsx as d } from "react/jsx-runtime";
import * as c from "react";
...
export {
  g as default
};
```

`react` / `react/jsx-runtime` が bundle されず bare specifier の `import` として残る = host (Harmony) と React を共有する契約どおり。`.mjs` / `manifest.json` / 出典 `.source.tsx` は `frontend/src/puck/__tests__/fixtures/external-dogfood/` に commit し、test を hermetic 化した (生成プロジェクト本体は `.tmp/` 配下で gitignored)。

---

## 生成・編集済 manifest.json 全文

```json
{
  "schemaVersion": "1",
  "components": [
    {
      "id": "approval-status-bar",
      "label": "承認ステータス帯",
      "module": "./dist/approval-status-bar.mjs",
      "export": "default",
      "version": "0.1.0",
      "engine": {
        "react": "19",
        "puck": "0.20"
      },
      "props": [
        {
          "name": "title",
          "type": "string",
          "label": "見出し",
          "default": "承認ステータス"
        },
        {
          "name": "status",
          "type": "enum",
          "label": "承認状態",
          "default": "pending",
          "enum": [
            { "label": "承認待ち", "value": "pending" },
            { "label": "承認済み", "value": "approved" },
            { "label": "却下", "value": "rejected" }
          ]
        }
      ],
      "slots": [
        {
          "name": "content",
          "label": "本文スロット"
        }
      ]
    }
  ]
}
```

---

## エラー UX サンプル (各 errorKind の detail 文言)

`ExternalComponentErrorCard` (`frontend/src/components/puck/ExternalComponentErrorCard.tsx`) が canvas 上に表示する赤系カードの headline。各 errorKind は以下の日本語文言で可視化される:

| errorKind | headline | detail の例 |
|---|---|---|
| `manifest-invalid` | manifest 不正 | `schemaVersion: "1" である必要があります (got "999")` |
| `version-mismatch` | バージョン不一致 | `react major 18 != host 19` |
| `missing-export` | export が見つかりません | `export "NotExist" が関数ではありません` |
| `load-error` | モジュール読込失敗 | `module パスが配信範囲外です (origin 不一致): https://evil.example.com/x.mjs` |
| `id-collision` | ID 衝突 | `ID 'Container' は既存 component と衝突` |
| `missing-dependency` | 依存部品が未ロード | `部品 type 'approval-status-bar' が読み込めません (未ロードの外部 component の可能性)` |

カードは部品名 (label) + id + 折り畳み式の detail を持つ。

---

## ブラウザ smoke

**未実施**。自動 test (上記 12 ケース) を一次証跡とした。理由:

- worktree の frontend (5173) を起動すると、開発中の main frontend と port 競合するため。
- backend (5179) は main 由来コードが常駐しており、`/workspace-assets/puck-components/manifest.json` を probe したところ HTTP 404 (= 本シリーズの route / 配置サンプルが未反映)。実機配信の前提が揃っていない。

cap1 は **実 vite build 成果物の .mjs を vitest (vite transform) 経由で実 import → render → hooks 動作**まで確認しており、ブラウザ smoke の主目的 (実 artifact が host React で動く) は自動 test で代替できている。実機ブラウザ smoke は本シリーズ最終 PR のリリース確認時に実施する。

---

## 発見した制約 / 対応

### F-1: 外部 component を `Component({...})` と直呼びすると hooks が必ず落ちる (test 作法、本 PR で吸収)

通し test 初版で cap1 を `item.Component({ status, title })` と関数直呼びで render しようとしたところ、`useState` が `Invalid hook call` で throw した。これは React component を render ツリー外で関数として呼ぶと dispatcher が null になるためで、**実装バグではなく test 作法の問題**。`createElement(item.Component, props)` で React element として render するよう修正し解消した (本 PR 内、`dogfoodExternalComponents.test.tsx:96`)。

→ 既存 `mergeExternalComponents` の render 経路は `createElement(Component, props)` を使っており正しい。外部 component を利用する側は必ず element 化して render する必要がある旨を本 dogfood で確認した (基盤側の追加対応は不要)。

### F-2: hermetic fixture .mjs の TS 型宣言 (本 PR で吸収)

実 build した `.mjs` を test から動的 import すると `tsc` が TS7016 (implicit any、宣言ファイル無し) を出した。`moduleResolution: bundler` では `*.mjs` import の宣言は `*.d.mts` のため、`approval-status-bar.d.mts` (default: unknown の最小宣言) を fixture に追加して解消した (本 PR 内)。

### 制約まとめ

P-1〜P-4 基盤に対する **修正を要する実装バグは検出されなかった**。capability 1〜6 はすべて実 build 成果物で期待どおり動作した。発見事項 F-1 / F-2 はいずれも本 dogfood test 側の作法・型宣言であり、本 PR 内で対応済 (鉄則 0 / 鉄則 1 遵守、放置・別 ISSUE 化なし)。
