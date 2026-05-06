# 画面項目連携: サンプル・既存データの整備 + 配置時 name/id 自動入力 計画

> **※ 本 plan は当時の実装メモ。記載 path は作成当時のもの。**
> **#753 / F-4 リネーム後は `docs/sample-project/` → `examples/<project-id>/` に読み替え。**

作成日: 2026-04-22  
前提: PR #326 (data-item-id 自動発番) + PR #325 (抽出モーダル) + #320 (画面項目定義ファイル) マージ済

## 背景

サンプル画面 (docs/sample-project/screens/\*.json) と既存の `data/screens/*.json` の `<input>` / `<select>` / `<textarea>` には `name` も `data-item-id` も付いていない。そのため:

1. 「画面デザインから追加」モーダル (#323) で候補を出しても `name` が空、label は placeholder フォールバック
2. `data-item-id` の紐付け (#326) も既存データには効かない (新規 drop 分のみ発番)
3. `data/screen-items/{screenId}.json` が 1 本も無いので処理フローからの `screenItemRef` (#321) 参照先も未整備

結果、現時点でサンプルを触っても「画面項目 ↔ 画面デザイン ↔ 処理フロー」の 3 層連携が体感できない。

## ゴール

- サンプル seed を再実行するだけで「name / data-item-id / 画面項目定義ファイル」までフル整備された状態になる
- 既存の `data/screens/*.json` (ユーザーが触った分) も 1 回のマイグレーションスクリプトで同じ状態に追いつける
- 今後 GrapesJS で新しい部品を dropped したら `name` / `id` が自動で埋まり、ユーザーが何もしなくても抽出可能

## スコープ (ユーザー合意済み)

- (C) seed.mjs 更新 + 既存 data/ マイグレーション
- (追加) GrapesJS 部品配置時の `name` / `id` 属性の初期値自動入力

---

## Part 1 — seed.mjs に name / data-item-id / 画面項目定義を埋め込む

**対象ファイル**: `docs/sample-project/seed.mjs`

### 変更内容

1. 画面ごとに「項目メタ配列」を定義し、`<input type="text">` / `<input type="password">` / `<input type="email">` 等に対応する `name`・`label`・`type`・`required`・`maxLength` 等を宣言。
2. HTML 組み立て時にそのメタから `name="..." id="..." data-item-id="..."` を注入。`data-item-id` は `randomUUID()` (node の `crypto.randomUUID`) で発番し、メタ側と HTML 側で同じ値を共有 (後工程で画面項目定義 JSON と突き合わせるため)。
3. 画面項目定義ファイル `docs/sample-project/screen-items/{screenId}.json` を生成するロジックを seed.mjs に追加。スキーマは [frontend/src/types/screenItem.ts](frontend/src/types/screenItem.ts) の `ScreenItemsFile`。`item.id` に (2) で発番した UUID をセットする。
4. `seed.mjs` の最後に `data/screen-items/` へ上記をコピーする処理を追加。

### サンプル画面の項目リスト (最低限)

- `aaaaaaaa-0001-...` ログイン: `user_id`, `password`
- `aaaaaaaa-0003-...` 顧客検索系: `keyword`, `status`, `from_date`, `to_date`
- `aaaaaaaa-0004-...` 顧客登録: `name`, `kana`, `email`, `phone`, `address`, `notes`
- `aaaaaaaa-0005-...` 顧客編集: 0004 と同じだが `id` で紐付け
- その他画面はメッセージ用 `<input>` だけでも OK (連携機能が動けばサンプル目的達成)

実在の画面 10 本をざっと見て、項目が有る画面のみ本格的にメタを書く。他は data-item-id 埋め込みだけで可。

### 冪等性

seed.mjs は元から上書き生成方式なので、実行のたびに UUID が変わっても問題ない (サンプルのため)。ただし「画面ごとの UUID セットを固定化」したほうが文書との対応が崩れないので、**seed.mjs 内でハードコードした UUID (文字列リテラル)** を使うこと。`crypto.randomUUID()` は使わない。

---

## Part 2 — 既存 data/ のマイグレーションスクリプト

**新規ファイル**: `scripts/migrate-screen-items.mjs`

ユーザーが `data/screens/*.json` を触っている場合、seed で上書きするとユーザー作業が消える。そこで別スクリプトで in-place migration を行う。

### 処理フロー

1. `data/screens/*.json` を読み取り、GrapesJS の `components` 文字列を正規表現で走査
2. `<input|select|textarea ...>` マッチに対して:
   - `data-item-id` が無ければ UUID を挿入
   - `name` が無ければ `field_<uuid 先頭 8 文字>` を挿入 (ユーザーは後で改名可能)
   - `id` が無ければ name と同じ値を挿入
3. 変更があった画面は `.bak.<timestamp>` に旧版退避して上書き保存
4. 画面ごとに `data/screen-items/{screenId}.json` を生成 (既存ファイルがあればマージ: 既存 id はそのまま、未登録 id のみ追加)
5. 実行結果をコンソールに出力: "画面 N 件、項目 M 件を新規付与"

### 冪等性

- 既に `data-item-id` がある要素はスキップ
- 既に `name` がある要素は name 側を尊重 (id / data-item-id だけ追加)
- 2 回目以降の実行は何もしないで終わる

### コマンド

```bash
node scripts/migrate-screen-items.mjs            # dry-run (変更一覧のみ表示)
node scripts/migrate-screen-items.mjs --apply    # 実書き込み
```

dry-run をデフォルトにしてユーザーが内容確認してから `--apply`。

---

## Part 3 — GrapesJS 部品配置時の name / id 自動入力

**対象ファイル**: [frontend/src/grapes/dataItemId.ts](frontend/src/grapes/dataItemId.ts) の拡張  
**可否**: 可能。既に `component:add` フックが入っているので、同じフック内で name / id も発番するだけ。

### 変更内容

`ensureDataItemId(cmp)` を `ensureFormFieldIdentity(cmp)` に拡張 (または新規関数を並置して `attachDataItemIdAutoAssign` で両方呼ぶ):

```ts
export function ensureFormFieldIdentity(cmp: Component): boolean {
  if (!isFormField(cmp)) return false;
  const attrs = cmp.getAttributes() ?? {};
  const patch: Record<string, string> = {};

  if (!attrs["data-item-id"]) {
    patch["data-item-id"] = generateUUID();
  }
  const dataItemId = patch["data-item-id"] ?? String(attrs["data-item-id"]);
  const shortId = dataItemId.split("-")[0]; // 8 文字

  if (!attrs.name) {
    patch.name = `field_${shortId}`;
  }
  if (!attrs.id) {
    patch.id = patch.name ?? String(attrs.name);
  }

  if (Object.keys(patch).length === 0) return false;
  cmp.addAttributes(patch);
  return true;
}
```

### 注意

- 既に name / id がある要素は**絶対に上書きしない** (ユーザーが手で付けた名前を壊さないため)
- `data-item-id` と name のペアは崩さない (同じ要素に対して data-item-id と name の `shortId` が一致するように)
- name は valid な HTML identifier (英数字 + `_`) であること。UUID の先頭 8 文字は hex なので条件を満たす

### 既存テスト

[frontend/src/utils/screenItemExtractor.test.ts](frontend/src/utils/screenItemExtractor.test.ts) の既存テストは name を持たない要素でも label フォールバックを期待しているので、テストケース追加のみで既存を壊さない。

### 新規テスト

- `dataItemId.test.ts` (新規):
  - form field drop 時に name / id / data-item-id が同時付与される
  - 既に name がある要素は name を上書きしない
  - button / submit / hidden には付与しない

---

## Part 4 — 仕様書・ドキュメント更新

- [docs/spec/screen-items.md](docs/spec/screen-items.md) に「GrapesJS 部品配置時の自動属性付与」節を追記
- [docs/sample-project/README.md](docs/sample-project/README.md) (あれば) に「seed.mjs で画面項目定義も生成される」ことを追記
- [CLAUDE.md](CLAUDE.md) の「Test Data」節にマイグレーションスクリプト `scripts/migrate-screen-items.mjs` を追加

---

## Part 5 — テスト方針

### Vitest

- `dataItemId.test.ts` (新規): 3 ケース (上記)
- `screenItemExtractor.test.ts` (追加): name / id が入った要素で extract → name と dataItemId が両方取れる

### Playwright

- `screen-items.spec.ts` (既存) に「seed 実行後の画面 0001 で画面デザインから追加を押すと 2 件 (user_id, password) 候補が出る」ケース追加
- 追加 E2E `data-item-id-auto.spec.ts` (新規): Designer を開いて `<input>` ブロックをドラッグ → 配置後に属性パネルで name / id / data-item-id が埋まっていることを検証

### 手動検証

1. `cd backend && npm run dev` 起動
2. `node docs/sample-project/seed.mjs` でサンプル再生成
3. ブラウザで画面項目定義を開き、画面 0001 を選択 → 「画面デザインから追加」→ 候補に user_id / password が出ることを目視
4. 処理フロー editor で inputs に `screenItemRef` 選択 → 画面 0001 の項目が選べることを目視
5. Designer で空画面に `<input>` ブロックを新規ドラッグ → HTML 属性に name="field_xxxxxxxx" / id="field_xxxxxxxx" / data-item-id="..." が入っていることを目視

---

## Issue / PR 構成

1 PR に統合 (同じ機能領域、[AGENTS.md「PR を過度に細かく分けない」](../../AGENTS.md#conventions) 準拠):

- branch: `feat/screen-item-sample-and-autofill`
- title: `feat(screen-items): サンプル整備 + 部品配置時 name/id 自動入力`
- body:
  - Part 1 (seed 更新)
  - Part 2 (マイグレーションスクリプト) 
  - Part 3 (配置時 name/id 自動入力)
  - 関連 issue: 新規 3 件を起票 (seed-enrich / migrate-existing / autofill-on-drop) し PR 本文でリンク

---

## 作業手順 (次セッション Sonnet 向け)

1. **Issue 起票** (3 本 or 1 本にまとめても可): サンプル整備 / マイグレーション / 配置時自動入力
2. **ブランチ作成** `git checkout -b feat/screen-item-sample-and-autofill`
3. **Part 3 から着手** (ファイルが小さく影響範囲が限定的) → Vitest 追加 → pass
4. **Part 1** seed.mjs 改修 → `node docs/sample-project/seed.mjs` 実行 → `data/screens/*.json` と `data/screen-items/*.json` を AI が確認
5. **Part 2** マイグレーションスクリプト作成 → dry-run 確認 → `--apply` 試走
6. **Part 4** ドキュメント更新
7. **Part 5** Playwright 追加 → `cd frontend && npx playwright test screen-items data-item-id-auto` pass
8. **vite build + lint** pass 確認
9. **PR 作成** `.github/pull_request_template.md` 全項目埋め、仕様逐条突合を `file:line` で列挙
10. **AI による独立レビュー → Must-fix 解決 → AI がマージ実行** (UI 影響あり時は AI 自身で chrome-devtools MCP / Playwright smoke test 実施。PR 単位ユーザー確認は不要、`feedback_ai_verifies_during_batch_work.md` 準拠)

## Acceptance Criteria

- [ ] `node docs/sample-project/seed.mjs` 実行後、`data/screens/aaaaaaaa-0001-...json` の HTML 文字列に `name="user_id"` と `data-item-id="..."` が含まれている
- [ ] 同じく `data/screen-items/aaaaaaaa-0001-...json` が存在し、`items` 配列に `name: "user_id"` エントリがある (id は HTML の data-item-id と一致)
- [ ] `node scripts/migrate-screen-items.mjs --apply` を既に空な状態 (seed 済) で実行しても "0 件変更" で終わる (冪等性)
- [ ] Designer で `<input>` ブロックを新規 drop → HTML 属性に name / id / data-item-id が初期値として入っている
- [ ] 「画面デザインから追加」モーダルで画面 0001 の候補が 2 件以上 (name 付き) 表示される
- [ ] 処理フローの inputs の screenItemRef で画面 0001 の項目が選べる
- [ ] Vitest 全件 pass / Playwright 関連 spec pass / vite build pass / lint pass
