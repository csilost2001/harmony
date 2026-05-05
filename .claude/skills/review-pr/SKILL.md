---
name: review-pr
description: PR を別セッション視点で厳格にレビューし、結果を PR コメントに投稿
argument-hint: <PR 番号>
disable-model-invocation: true
---

<!--
  使い方:
    - 新しい Claude Code セッション (別ウィンドウ/別タブ) で `/clear` してから起動
    - `/review-pr 149` のように PR 番号を指定して **明示的に** 呼び出す
    - レビュー結果は `gh pr comment` で PR に投稿される

  目的:
    - 実装担当とは別セッションで独立レビューすることで、筆者の盲点を洗い出す
    - 「機械 CI = 網羅的・構文的チェック」に加え「意味論的・仕様準拠レビュー」を担う
    - Max プラン内で完結 (追加 API 課金なし)

  発動制御:
    - frontmatter の `disable-model-invocation: true` により、Claude が description マッチで
      自動起動することを禁止している。ユーザーが明示的に `/review-pr <N>` と打った時のみ起動。
    - 「レビュー指摘を確認して」「レビューに対応して」等の指示では起動しない (別ワークフロー)。
-->

PR #$ARGUMENTS を独立視点で厳格にレビューしてください。

## 役割と前提

- **あなたはレビュアー専任**。筆者 (別セッションの Claude) が作成した PR を監査する
- 筆者も同じモデル。**共通の盲点がある可能性が高い**。「妥当そうに見える」を疑い、具体的に数え上げる姿勢で臨む
- 実装コミットは作らない。レビュー報告のみ

## 正の仕様

`docs/spec/` 配下が正。PR 本文「関連」節の spec 節リンクが起点。

- spec との差分があれば、**実装のバグか spec の不備**のどちらかを明確に指摘
- spec が曖昧なら、PR 本文「spec 側の不足点 / 提案」節を確認。筆者が既に認識しているか

## レビュー手順 (この順で実施)

### Step 0: 情報収集 — 並列実行

**同じ PR への 2 回目以降の呼び出しかもしれないため、最新状態とコメント履歴を必ず取得して現状を判断する。** 過去の Claude Review コメントがあっても「既にレビュー済み」で即終了せず、PR を読んだ上で **初回レビュー** / **再レビュー (対応監査)** / **再レビュー不要 (対応コミットなし)** のいずれかを判断する。

以下を並列で:

- `gh pr view $ARGUMENTS --json title,state,body,additions,deletions,changedFiles,baseRefName,headRefName,mergeable`
- `gh pr view $ARGUMENTS --comments` (**過去の Claude Review コメントも取得**)
- `gh pr diff $ARGUMENTS --name-only`
- PR 本文から関連 issue 番号を抽出し `gh issue view <N> --comments` で決定経緯を追う
- PR 本文「関連」節の spec ファイルを特定し全文読む (該当節だけでなく前後関係も)

情報収集が終わったら、PR 本文「レビュー担当への申し送り」節を熟読し、何を重点的に見るかを決める。過去の Claude Review コメントがあれば、前回指摘と最新コミットを突合して対応状況を確認する (再レビュー時)。

### Step 1: spec 逐条突合

spec の**各条項について**、実装のどこがどのように満たしているかを file:line で確認:

- PR 本文「仕様逐条突合 (自己申告)」節の file:line が**実際に正しいか**を検証する
- 自己申告に含まれない条項も全て確認 (抜けている条項こそ盲点の可能性)
- 「満たしている ✓」ではなく「**該当コードがこう書かれているから満たしている**」と説明できるまで確認
- 満たしていない / 曖昧 / 実装ミスに該当する条項は Must-fix か Should-fix で指摘

### Step 2: 系統的な抜け漏れチェック

実装の「似たロジックが複数箇所に存在するパターン」を全経路で grep 網羅:

- 同種の処理を呼ぶべき箇所で**呼ばれていない経路**がないか (今回の #148 例: `editor.setItems` 直打ち箇所の renumber 抜け)
- 特定条件で無効化すべき操作で**ガードが抜けている UI 要素**がないか (ボタン・ショートカット・コンテキストメニュー・D&D 等)
- データの不変条件が全ての書き込み経路で保たれているか

grep ベースで経路を列挙し、各経路で期待処理の有無を表にする。

### Step 3: テストの偽陽性チェック

Vitest / Playwright のテストが「**ガードが効いたから通った**」のか「**前提が揃わず通った**」のかを判定:

- `.claude/skills/test-strategy/SKILL.md` の「抑制系修正のフィクスチャ選定」章が参考になる
- 「何もしない」テストが通った時、ガードが効いたからか前提が揃わなかったからか区別できるかを確認
- 可能なら `cd designer && npx vitest run` を実行して claim された pass 数を実測確認
- Playwright は時間がかかるので実行は任意。コードレベルで偽陽性パターンを指摘

### Step 4: コード品質

- 過剰な抽象化 / デッドコード
- 既存 API (共通コンポーネント・フック) との整合
- 型安全性 (`as` キャスト・`any`・Non-null assertion の妥当性)
- 不要なコメント (タスク参照・自明な説明・ファイルヘッダの冗長な説明)
- 命名の一貫性

### Step 5: schema 変更チェック (最重要、#511 で導入)

PR diff に **`schemas/*.json` (グローバル定義スキーマ) 変更が含まれているか** を必ず確認:

```bash
gh pr diff <PR番号> --name-only | grep -E "^schemas/"
```

変更がある場合は以下を Must-fix として指摘:

1. **設計者承認 ISSUE が紐付いているか確認** (PR description / 元 ISSUE で明示的に schema 改修を承認していなければ NG)
2. **拡張機構 (namespace 拡張定義) で代替できないか確認** (`examples/<project-id>/extensions/<namespace>/*.json` で表現可能なら schema 変更不要)
3. **既存 schema フィールドで代替表現できないか確認** (`type: "other"` + outputSchema パターン等)
4. テスト pass を理由に schema を勝手に拡張するのは**絶対 NG**

紐付かない schema 変更は **必ず Must-fix** で指摘し、revert もしくは別 ISSUE 起票を推奨。memory `feedback_schema_governance_strict.md` 参照。

### Step 5.5: マルチエディタ対応レビュー (#806)

PR diff に画面関連ファイル (`screens/` / `Designer.tsx` / `PuckBackend` / `CssFrameworkContext` 等) が含まれる場合:

1. **editorKind / cssFramework 解決順序の一貫性**: screen → project → default の 3 段解決が正しく実装されているか
   - `screen.design.editorKind` → `project.techStack.designer.editorKind` → `"grapesjs"` の 3 段フォールバック (#826 で `project.design` から移行)
   - `screen.design.cssFramework` → `project.techStack.designer.cssFramework` → `"bootstrap"` の 3 段フォールバック (#826 で `project.design` から移行)
   - 解決ロジックが 1 か所に集中しているか (複数箇所に分散して解決順序がズレていないか)
2. **動的コンポーネント定義の primitive 妥当性**: 登録される `primitive` フィールドが `BUILTIN_PRIMITIVE_NAMES` に含まれる既知の名前であるか
   - `BUILTIN_PRIMITIVE_NAMES` は `designer/src/puck/buildConfig.ts` でエクスポートされている
   - 未知の primitive 名を登録すると Puck Config 構築時に silent fail する
3. **Puck 画面の Thymeleaf 出力スキップ**: Thymeleaf HTML を生成するコードパスで `editorKind === "puck"` 画面を明示除外しているか

詳細仕様: `docs/spec/multi-editor-puck.md` § 2.3 / § 4.1 / § 4.2

## 制約 (必守)

- **マージしない**
- **push しない**
- `docs/spec/` を勝手に書き換えない (spec 不備は指摘のみ)
- 追加の実装コミットを作らない (`git commit` / `git push` 禁止)
- テスト実行は read-only の範囲 (`npx vitest run` / `npx playwright test` は可、ただし `--update-snapshots` 等の書き込みオプションは不可)
- ファイル編集は `tmp/review-cache/` 配下の一時ファイルのみ可 (レビュー結果書き出し用。`tmp/` は `.gitignore` 済)

## 報告フォーマット

結果を一時ファイルに書き出してから `gh pr comment` で投稿する。

一時ファイルの保存先は **プロジェクト直下の `tmp/review-cache/` 配下** にする (OS 非依存・`.gitignore` 済で commit 事故なし・`gh` から絶対パスで参照可能・`.claude/` 配下の保護対象外なので書き込み確認が不要)。Unix の `/tmp/` や Windows の `%TEMP%` はツール間で path 解決が揺れるため使わない。

### 1. 一時ファイルに書き出し

事前に `mkdir -p tmp/review-cache` でディレクトリを確保してから、`tmp/review-cache/review-pr-$ARGUMENTS.md` に以下の構造で書き出す:

```markdown
## Claude Review (別セッション) — <YYYY-MM-DD>

**レビュアー**: Claude <モデル名 / ID>
**対象コミット**: <最新コミット SHA 先頭 7 文字>
**レビュー手順**: spec 逐条突合 + 系統的抜け漏れチェック + テスト偽陽性チェック + コード品質

---

### Must-fix

- `<file>:<line>` — <問題点> / 推奨修正: <...>

### Should-fix

- `<file>:<line>` — <問題点> / 推奨修正: <...>

### Nit / 質問

- ...

---

### spec 逐条突合結果

#### §X.Y <章タイトル>

| 条項 | 実装箇所 | 判定 |
|---|---|---|
| (a) <条項要約> | `<file>:<line>` | ✓ |
| (b) <条項要約> | — | ❌ <欠落内容> |
| ... | ... | ... |

---

### 検証方法

- `gh pr view` / `gh pr diff` で差分把握
- 主要ファイル読み込み: <リスト>
- `cd designer && npx vitest run` → <pass 数> 件 pass 確認 / 未実行
- Playwright: 未実行 / 実行済

---

### 総合評価

**マージ可 / 修正後マージ / 大幅修正必要** のいずれか。短い根拠付きで。

UI 影響のある PR ならマージ判断はユーザー。レビューは判断材料の提供。
```

### 2. PR にコメント投稿

```bash
gh pr comment $ARGUMENTS --body-file tmp/review-cache/review-pr-$ARGUMENTS.md
```

投稿前にユーザーの許可を得るフローになる (権限設定による)。拒否された場合でも `tmp/review-cache/review-pr-$ARGUMENTS.md` に結果が残っているので、ユーザーが内容を確認してから手動で投稿できる。

### 3. 完了報告

投稿完了後、ユーザーに短く報告:

- Must-fix / Should-fix の件数
- 総合評価 (マージ可 / 修正後マージ / 大幅修正必要)
- PR URL (`gh pr view $ARGUMENTS --json url --jq .url`)

## 注意事項

- 筆者も同じモデルなので共通の盲点がある可能性が高い。表面的な一致だけで「満たしている」と判定しない
- PR 本文の「仕様逐条突合 (自己申告)」を**そのまま信じない**。file:line が本当に該当条項を満たすコードになっているかを都度確認
- 「完了報告」ではなく「監査」。疑わしい箇所は全て Should-fix 以上に挙げる
- UI 影響のある PR は最終マージはユーザー判断。レビューはあくまで判断材料
