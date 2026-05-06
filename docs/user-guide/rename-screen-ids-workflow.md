# 画面項目 ID の AI 自動命名 (`/rename-screen-ids`)

## 概要

フォーム要素を画面に配置すると、初期 ID は `textInput1`・`select3` などの自動採番になります。これをコードで使える業務名 (`userName`・`postalCode`) に変換するのが `/rename-screen-ids` コマンドです。

Claude Code が画面の label / placeholder / 見出しを読んで命名を推論し、ユーザー確認後に一括適用します。

## 使い方

### 基本 (現在開いている画面を対象)

```
/rename-screen-ids
```

ブラウザで画面デザイナーを開いた状態で実行します。アクティブなタブの画面が自動検出されます。

### 画面 ID を指定

```
/rename-screen-ids aaaaaaaa-0001-4000-8000-aaaaaaaaaaaa
```

画面 ID は画面一覧または URL (`/screen/design/<id>`) から確認できます。

## 処理の流れ

```
/rename-screen-ids
  │
  ├─ 1. 未命名項目を取得 (get_rename_context)
  │
  ├─ 2. Claude が業務名を推論
  │       label: 氏名     → fullName
  │       label: 郵便番号 → postalCode
  │
  ├─ 3. マッピング表を提示 → ユーザー確認
  │       | textInput1 → fullName  |
  │       | textInput2 → postalCode |
  │       このマッピングで適用してよいですか？
  │
  ├─ 4. yes → apply_rename_mapping を実行
  │
  └─ 5. 結果報告 (成功 / 失敗 / スキップ)
```

## 命名ルール

Claude が推論に使うルール (変更不可):

| ルール | 内容 |
|--------|------|
| 形式 | camelCase (`userName`, `postalCode`) |
| 文字 | 英数字のみ。ハイフン・アンダースコア不可 |
| 長さ | 30 字以内 |
| 禁止 | JS 予約語 (`let`, `const`, `class` 等) |
| 推論不能 | スキップ (現在の自動採番 ID を維持) |

## 対象・対象外

| 項目 | 扱い |
|------|------|
| `textInput1`, `select3`, `field_69f9561e` 等の自動生成 ID | **対象** (リネーム候補) |
| `userName`, `postalCode` 等の業務命名済み ID | **対象外** (保護) |

## 確認フローの重要性

このコマンドは処理フローの `screenItemRef` も追従してリネームします。意図しないリネームは処理フロー定義に影響するため、**必ず提示されたマッピングを確認してから yes を応答してください。**

修正したい場合は「`textInput1` は `loginName` にしてください」と返答すると、Claude がマッピングを修正して再提示します。

## よくある Q&A

**Q: 一部だけリネームしたい**
A: yes の前に「`textInput3` はスキップして」と伝えると対応します。

**Q: 推論が間違っていた**
A: 確認ステップで修正を伝えてください。適用前に変更できます。

**Q: 画面デザイナーが開いていないと言われた**
A: ブラウザで `/screen/design/<id>` を開いてから再実行してください。

**Q: screen-items ファイルがないと言われた**
A: 画面デザイナーで一度フォーム要素をドロップして保存すると、`data/screen-items/<id>.json` が生成されます。

---

## ブラウザボタン版 (#337)

Claude Code セッションを開かずにブラウザだけで AI 命名を実行できます。

### 前提

- `backend` が稼働していること (`cd backend && npm run dev`)
- `backend` が稼働するマシンで `claude login` 済みであること

認証確認コマンド:

```
claude auth status
```

### 使い方

1. ブラウザで画面デザイナーを開く (`/screen/design/<id>`)
2. ツールバー左端の **✦ ボタン** (IDを AI で再命名) をクリック
3. AI が未命名項目を分析 → マッピングを提示
4. 内容を確認して **「適用する」** をクリック
5. 完了トーストで成功 / 失敗件数を確認

> **ボタンが無効の場合**: `claude login` 未実行または `backend` 未起動です。

### トラブルシューティング

| 症状 | 対処 |
|------|------|
| ボタンが灰色でクリックできない | `claude auth status` で認証確認 / `claude login` を実行 |
| 「通信エラー」が出る | `backend` が起動しているか確認 |
| タイムアウト (60秒) | 画面項目数が多すぎる場合は `/rename-screen-ids` コマンド版を使用 |

## 関連

- MCP ツール仕様: [`docs/spec/screen-items.md` — AI 推論セクション](../spec/screen-items.md)
- ID の手動リネーム: `designer__rename_screen_item` ツール
- 画面項目 ID の仕組み: [`docs/spec/screen-items.md`](../spec/screen-items.md)
