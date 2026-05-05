# マルチエディタ / Puck デザイナ 使い方ガイド

本ガイドは **#806 マルチエディタ対応 (Puck 併設)** で追加された機能の使い方を説明します。  
対象: 業務画面を設計する業務設計者。

---

## 1. 画面新規作成: editorKind / cssFramework を選ぶ

画面を新しく作るとき、2 つの設定を選択します。

### editorKind (エディタ種別)

| 選択肢 | 説明 |
|--------|------|
| `grapesjs` (既定) | 従来の GrapesJS デザイナ。HTML ブロック drag & drop が中心 |
| `puck` | Puck デザイナ (本ガイドで説明)。React コンポーネントベースで WYSIWYG リアルタイム反映 |

**一度設定したら変更不可**。プロジェクト内で画面ごとに異なる種別を混在できます。

### cssFramework (CSS フレームワーク)

| 選択肢 | 説明 |
|--------|------|
| `bootstrap` (既定) | Bootstrap 5。既存システムとの互換性が高い |
| `tailwind` | Tailwind CSS utility-first。モダン UI に最適 |

**一度設定したら変更不可**。同一プロジェクト内で画面ごとに異なるフレームワークが使えます。

### 解決の優先順位

画面個別に指定がない場合、以下の順で自動決定します:

```
1. screen.design.editorKind / cssFramework  ← 画面個別指定
2. project.techStack.designer.editorKind / cssFramework ← プロジェクトのデフォルト (#826 で project.design から移行)
3. "grapesjs" / "bootstrap"                 ← システム最終デフォルト
```

**typical 運用** (全画面同一): プロジェクトのデフォルトだけ設定すれば各画面に書かなくて済みます。  
**部分更新** (旧システムの一部だけ Tailwind/Puck 化): 該当画面だけ個別 override を記述します。

---

## 2. Puck デザイナの使い方

`editorKind: "puck"` の画面を開くと Puck デザイナが表示されます。

### 画面構成

```
┌──────────┬────────────────────────────┬────────────────┐
│ パレット │        中央キャンバス        │  右プロパティ  │
│ (左列)   │ (WYSIWYG プレビュー)        │  パネル        │
│          │                            │                │
│ heading  │  [ここにドロップ]           │  align: 左     │
│ paragraph│                            │  padding: md   │
│ button   │                            │  ...           │
│ ...      │                            │                │
└──────────┴────────────────────────────┴────────────────┘
```

### primitive をキャンバスに配置する

1. 左パレットから置きたい primitive (heading / paragraph / button 等) を探す
2. 中央キャンバスにドラッグ&ドロップ
3. キャンバスに即座に配置される

### 右プロパティパネルで見た目を調整する

配置した要素を選択すると右プロパティパネルが表示されます。  
**共通レイアウト props** で余白・配置・色をリアルタイム WYSIWYG で操作できます。

| prop | 設定値例 | 操作できる見た目 |
|------|----------|-----------------|
| `align` | left / center / right | テキスト・コンテンツの水平配置 |
| `padding` | none / sm / md / lg / xl | 内側余白 |
| `paddingX` / `paddingY` | 同上 | 水平/垂直の内側余白 |
| `margin` | none / sm / md / lg / xl | 外側余白 |
| `marginBottom` / `marginTop` | 同上 | 下/上の外側余白 |
| `gap` | none / sm / md / lg | 子要素間の間隔 |
| `colorAccent` | default / primary / secondary / muted / success / warning / danger | 文字色アクセント |
| `bgAccent` | none / white / muted / primary-soft / ... | 背景色 |
| `border` | none / default / strong | 枠線 |
| `rounded` | none / sm / md / lg / full | 角丸 |
| `shadow` | none / sm / md / lg | 影 |

**例: テキストを右寄せにする**

1. キャンバスで `heading` 要素をクリックして選択
2. 右プロパティパネルの `align` を `right` に変更
3. キャンバスに即座に反映 (リロード不要)

#### cssFramework による出力の違い

同じ prop 設定でも cssFramework によって出力される class が異なります:

| prop | 値 | tailwind 出力 | bootstrap 出力 |
|------|----|---------------|----------------|
| align | right | `text-right` | `text-end` |
| padding | md | `p-4` | `p-3` |
| colorAccent | primary | `text-blue-600` | `text-primary` |

**Puck Data (保存ファイル) は cssFramework に依存しない** semantic props 構造で保存されます。  
これにより、将来 cssFramework を変えても保存データはそのまま使えます。

### 画面の保存と復元

- **保存**: 上部の「保存」ボタンをクリック (GrapesJS と同様の明示保存式)
- **復元**: 保存済みの画面を開くと自動でデータを読み込み、前回の状態が復元される

保存先ファイル: `workspaces/<wsId>/screens/<screenId>/puck-data.json`

---

## 3. 動的コンポーネント登録の使い方

既存の primitive に加えて、独自の「業務向けコンポーネント」をダイアログで定義・登録できます。

### 登録ダイアログの起動

Puck デザイナ上部の「コンポーネント登録」ボタンをクリック。

### 定義項目

| 項目 | 説明 | 例 |
|------|------|---|
| コンポーネント名 (label) | パレットに表示される名前 | `検索バー` |
| 種類 (primitive) | ベースとするビルトイン primitive | `input-group` |
| プロパティ | 追加するプロパティ名・型・デフォルト値 | placeholder: string, buttonLabel: string |

### 定義後の動作

1. 「登録」をクリックするとパレットに即座に反映 (再起動不要)
2. 定義は `workspaces/<wsId>/puck-components.json` に永続化される
3. 同一 workspace の他のブラウザタブにも自動で伝搬される

### 利用可能な primitive の種類

| primitive | 用途 |
|-----------|------|
| `container` / `row` / `col` / `section` | レイアウト構造 |
| `heading` / `paragraph` / `link` | テキスト |
| `input` / `select` / `textarea` / `checkbox` / `radio` / `button` | フォーム入力 |
| `table` / `image` / `icon` | データ表示 |
| `input-group` / `card` / `data-list` / `pagination` | 業務複合 |

---

## 4. 部分更新シナリオ (旧システムの一部画面だけ Tailwind/Puck 化)

既存プロジェクト (bootstrap + grapesjs) の一部画面だけ新技術に移行する手順:

### 手順

1. **プロジェクトのデフォルト設定はそのまま** (`bootstrap` / `grapesjs`)
2. **新しく作る特定画面だけ** `editorKind: "puck"` / `cssFramework: "tailwind"` を選択
3. 旧画面 (grapesjs) と新画面 (puck) が同一プロジェクトで共存する

### 注意事項

- 同一プロジェクト内で全 4 セル (`grapesjs × bootstrap` / `grapesjs × tailwind` / `puck × bootstrap` / `puck × tailwind`) が混在可能
- **Thymeleaf テンプレート出力**: `editorKind: "puck"` 画面は React コンポーネントを前提とするため、Thymeleaf 出力ツールは Puck 画面を自動スキップし、スキップした画面名をレポートに記録します
- 画面間のナビゲーション (画面フロー edges) はエディタ種別に関わらず統一管理されます

---

## 5. トラブルシューティング

### Puck キャンバスが真っ白に表示される

- `puck-data.json` が存在しないか壊れている可能性があります
- designer-mcp が起動していない場合は localStorage にフォールバックします
- `workspaces/<wsId>/screens/<screenId>/puck-data.json` の存在を確認してください

### 動的コンポーネントがパレットに表示されない

- `puck-components.json` の `primitive` フィールドが既知の名前か確認してください (大文字小文字は無視されます)
- ブラウザをリロードしてください

### cssFramework を変えても見た目が変わらない

- `editorKind: "puck"` の画面作成後は cssFramework を変更できません (作成時固定)
- 同じデザインで別 cssFramework が必要な場合は、新しい画面を作成してください

---

*詳細仕様: [`docs/spec/multi-editor-puck.md`](../spec/multi-editor-puck.md)*
