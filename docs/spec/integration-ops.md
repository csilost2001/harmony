---
description: "連携と運用 (Word / Excel 書き出し・設計書の体裁と改訂履歴・図の書き出し・Git・レビューコメント・承認・利用者と権限・変更の記録・通知・DDL / OpenAPI / Excel の取り込み・生成の管理・技術スタックのプリセット・版とリリースノート・初回セットアップ・資料の鮮度検査)"
status: current
category: ops
---

# 連携と運用 — 仕様書 (改善提案 第 5 弾)

**Status**: 実装済 (2026-10)
**関連**: [design-document.md](design-document.md) / [design-analysis.md](design-analysis.md) / [file-backup.md](file-backup.md) / [server-security.md](server-security.md) / [external-change-detection.md](external-change-detection.md) / [ux-operations.md](ux-operations.md)

外へつなぐ・配る・チームで使う機能のまとめ。**スキーマ (`schemas/v3/`) は変えない**。承認・コメント・権限・体裁・生成の記録・通知は、`design-check.json` と同じ「運用の設定 / 記録」で、コード側で形を検証する。取り込み (DDL・OpenAPI) は、既存のスキーマの形の設計を**新規に**作るだけで、既存の設計は上書きしない。

## 0. 方針

| 方針 | 内容 |
|---|---|
| 記録の置き場所 | チームで共有するものは `<データフォルダ>/` (git に載る): `document-template.json` `approvals.json` `review-comments.json` `access.json` `generation.json`。個人・秘密のものは `<ワークスペース>/.harmony-ops/` (自分の `.gitignore` で git に載せない): `notify.json` (通知先の URL) `audit.jsonl` (変更の記録) `gen-snapshots/` (生成のときの設計の写し) `notify-state.json` |
| 読み込み | 読み込みのたびに検証し、読めない項目は捨てて理由を返す (手で書き換えた 1 行の誤りで、全体を止めない)。**読めない項目のあるファイルへは、書かない** (書くと、その項目が消えるため)。利用者が「読めない項目は捨てる」と承知したときだけ、読める範囲で書く。JSON の構文が壊れているファイルへは、どちらでも書かない |
| 要確認への反映 | 上のファイルの読めない項目は、設計の「要確認」(警告・読み込み) に出る (`collectOpsIssues`) |
| 外へ出す操作 | 通知・Git のコミットは、利用者が登録・実行したものだけ。**AI (MCP) には、通知先の登録・変更・送信先の指定・コミットの経路を渡さない**。AI に渡すのは、生成の記録・レビューの指摘の読み書きだけ。AI の指摘 (`designer__add_review_findings`) は、利用者が登録済みの「コメント」の通知先へ、**件数だけの 1 通** (コメントの文は含めない) が届く。読み取り専用モード `HARMONY_MCP_MODE=readonly` では、読み取りの tool だけ |
| 利用者名 | ブラウザごとの自己申告 (画面右上)。**本人確認ではない**。画面からの要求に `actor` として付く |
| 監査 | 画面からの設計・設定の変更と、AI の書き込みの tool は、監査ログに残る (§9) |

## 1. Word / Excel への書き出し (設計書ビューの「Word」「Excel」)

- 設計書 (HTML、`buildDesignDocument`) の見出し・段落・箇条書き・表・基本情報を、ブロック (`shared/src/export/htmlBlocks.ts`) にして、外部の依存なしに OOXML (docx / xlsx) の ZIP にする (`ooxml.ts`・`zip.ts`。ZIP は無圧縮の stored 方式)。
- **含めないもの**: 処理フロー図・業務フロー図 (SVG)、画面・帳票の紙面の見本。図は、HTML で保存・印刷するか、§3 の図の書き出しを使う。
- docx: 表紙 (体裁の項目の表) → 改ページ → 本文。見出しは Word の見出し 1〜4 (ナビゲーションウィンドウで辿れる)。表は見出し行つき。ヘッダー (体裁の `headerText`) とフッター (`footerText` + ページ番号)。A4 縦。
- xlsx: 章 (見出し 1・2) ごとに 1 シート。シート名は、使えない文字 (`[ ] : * ? / \`) を除き、31 文字以内・重複なしにする。見出し行は太字・塗りつぶし。長いセルは折り返し。1 セル 32,000 文字まで。
- PDF: 設計書の「別タブで開く」から、ブラウザの印刷 → PDF として保存する (自前の PDF 生成は、日本語フォントの埋め込みが要るため行わない)。
- 読み込み (取り込み用): `readZip` (stored・deflate。展開後 64 MB まで) / `readXlsx` (§10)。deflate の展開は、ブラウザの `DecompressionStream`、Node では zlib。上限: 1 つの項目 64 MB・合計 256 MB・項目数 10,000 (ZIP 爆弾の対策)。

## 2. 設計書の体裁と改訂履歴 (設計書ビューの「体裁・改訂履歴」)

`<データフォルダ>/document-template.json` (形の検証: `shared/src/docTemplate.ts` の `parseDocTemplate`):

| 項目 | 内容 |
|---|---|
| `documentTitle` `subtitle` `docNumber` `organization` `author` `classification` | 表紙に出す文書名・副題・文書番号・組織名・作成者・秘区分 |
| `stamps` | 押印欄の見出し (既定: 承認 / 審査 / 作成。空にすると押印欄を出さない) |
| `headerText` `footerText` | Word のヘッダー・フッター |
| `accentColor` | 強調の色 (`#rrggbb`)。表紙の上の線と章の見出しの下線 |
| `excludeChapters` | 設計書に載せない章 (目次の id)。**章番号は、載せる章だけで振り直す**。要確認事項の検査は、外した章も対象のまま |
| `revisions` | 改訂履歴 (版・日付 YYYY-MM-DD・変更者・内容)。設計書の表紙のあとに、新しい版を上にした表で載る (Word・Excel にも載る) |

- 改訂履歴の「更新から下書き」: 前回の改訂の日付 (なければ 14 日前) のあとに、保存前の版 (`.harmony-backups/`、[file-backup.md](file-backup.md)) が残った設計を拾い、「テーブル「注文」を更新 (3 回)」の形の要約を作る。人が確かめて、版・内容を直して保存する (自動では確定しない)。
- 並び順の変更 (章の入れ替え) は対象外。

## 3. 図の書き出し (設計の分析 → 書き出し → 図)

`shared/src/diagrams.ts`。設計の原本だけから作る (画面の配置の座標は使わない)。

| 図 | Mermaid | PlantUML | SVG |
|---|---|---|---|
| ER 図 (全テーブル。外部キーの関係) | ○ (`erDiagram`) | ○ | — |
| 画面遷移図 (全画面) | ○ (`flowchart LR`) | ○ | — |
| 処理フロー図 (処理 = action ごと。分岐・繰り返し・トランザクション・return) | ○ (`flowchart TD`) | ○ | ○ (設計書と同じ描画) |
| 業務フロー図 (レーンごとにまとめる) | ○ (subgraph) | ○ (package) | ○ (設計書と同じ描画) |

- 名前の `"` と `|` は、図の記法を壊すので置き換える (`'` と `｜`)。ER の型は、型の名前だけ (長さは省く)。
- SVG は、単体で開ける (名前空間・設計書と同じ配色の CSS・白い背景つき)。処理フローは、処理が複数あるとき 1 つずつ。

## 4. Git 連携 (連携と運用 → Git)

`backend/src/ops/gitOps.ts`。`git` を、シェルを通さずに (`execFile`) 呼ぶ。範囲は**ワークスペースのフォルダの中だけ** (`-- .`)。

- できること: 状態 (変更・未追跡のファイル) / ファイルの差分 / 選んだファイルだけのコミット / ブランチの一覧・作成・切り替え / 履歴 20 件 / `git init` (管理者)。
- **しないこと**: push・pull・fetch・merge・rebase・reset・履歴の書き換え (リモートへ出す・取り込む・元に戻せない操作は、利用者が git を直接使う)。
- 守り: 他人から受け取ったリポジトリの設定 (`core.fsmonitor`・`core.hooksPath`・`diff.external`・`core.sshCommand` など、コマンドを実行させる項目) とフックを、**無効にして**呼ぶ (状態を見ただけで、コマンドが走らないように。コミットは `--no-verify`)。場所は相対・外へ出ない・先頭が `-` でない。ブランチ名は英数字と `. _ / -` だけ。コミットしていない変更があるときは、ブランチを切り替えない。競合中のファイルがあるときは、コミットしない。名前・メールが未設定なら、操作した人の名前と `harmony@localhost` を、そのコミットにだけ使う。上の階層のリポジトリがこのフォルダを無視しているとき (`workspaces/` が `.gitignore`) は、「リポジトリではない」として扱う。
- 編集中で保存していない内容 (サーバの下書き) は、コミットされない。

## 5. レビューコメント (ヘッダーの「レビュー」、連携と運用 → レビューと承認)

`<データフォルダ>/review-comments.json`。設計の**箇所** (`columns[2]` など。任意) に紐づくスレッドと、解決の状態。

- 付箋 (マーカー) は「AI への依頼」、レビューコメントは「人どうしの議論と、AI レビューの指摘」。両者は別のもの。
- 誰でも (閲覧の役割でも) 書ける・返信できる。解決・開き直しは「編集」以上。解決済みのスレッドに返信すると、開き直す。
- 上限: スレッド 5,000・1 スレッドのコメント 200・1 コメント 4,000 文字。
- AI の指摘: `designer__add_review_findings` (kind / id / path / message / severity、50 件まで) が、「AI レビュー」のスレッドとして残す。同じ箇所に同じ内容の未解決のスレッドがあれば、重ねない。読む: `designer__list_review_comments`。

## 6. 承認 (ヘッダーの「レビュー」、連携と運用 → レビューと承認)

`<データフォルダ>/approvals.json`。設計ごとの状態: 下書き → 承認待ち → 承認済み / 差し戻し。履歴 (誰が・いつ・メモ) を 50 件まで残す。

- 承認したときの**内容の印** (SHA-256) を残す。印は、設計の内容から成熟度 (`maturity`)・更新日時 (`updatedAt`) を除いた正規形から作る。承認のあとに内容が変わると「承認後に変更」と表示し、確定の検査 (§7) も通らなくなる。
- 遷移と必要な役割: 承認を依頼 (編集) / 承認・差し戻し (承認。**差し戻しは理由が必須**) / 下書きに戻す (編集)。
- 「確定には承認を必須にする」(`access.json` の方針) が有効なとき: 保存の直前の検査 (`writeJSON` の前) が、成熟度 `committed` の保存を、「承認済みで、内容の印が一致している」ときだけ通す。**画面からの保存も AI の書き込みも対象**。確定のままの設計を編集するには、成熟度を戻して編集し、もう一度承認を受ける。方針が有効で未承認・承認後に変更の確定の設計は、設計の「要確認」に警告として出る。**限界**: 保存の直前の検査を通らない書き込みの経路 (改名・設計全体の置換など、複数ファイルを直接書き換える操作) では、止まらない。その場合は、内容が変わるので「承認後に変更」になり、この要確認で見つかる。改名では、承認・レビューコメント・生成の記録の id を、新しい id に付け替える (取り消しで戻す)。

## 7. 利用者と権限 (連携と運用 → 利用者と権限)

`<データフォルダ>/access.json`: 利用者名と役割 (閲覧 < 編集 < 承認 < 管理)、方針 (`requireApprovalForCommitted`)。

- **登録が 1 人もなければ、これまでどおり制限しない**。登録すると、登録のない名前 (名乗っていない人を含む) は「閲覧」。
- 設計を変える RPC (保存・削除・改名・置換・編集セッションの開始と保存・保守) は「編集」以上。承認は「承認」以上。設計書の体裁・コミット・ブランチの切り替えは「編集」以上。通知先・git init・この設定の変更は「管理」。最初の設定では、自分を「管理」にする (管理者がいなくなる保存は拒否する)。
- 最初の設定 (登録が 0 人の状態からの保存) は、誰でもできる。そのとき、保存する人自身を「管理」にする。
- **限界**: 利用者名は自己申告で、本人確認ではない。誤操作・誤った承認を防ぐ運用上の区別であり、なりすましは防げない。防ぐには、接続トークン (`HARMONY_AUTH_TOKEN`) とネットワークの制限を併用する。AI (MCP) の権限は、この設定の対象外で、`HARMONY_MCP_MODE` / `HARMONY_MCP_DENY` で別に決める。

## 8. 通知 (連携と運用 → 通知)

`<ワークスペース>/.harmony-ops/notify.json`。Slack・Teams・汎用 (JSON) の Webhook へ、承認の状態の変化・レビューコメント・要確認の増加・Git のコミットを知らせる。

- 送るのは、名前・状態・件数・コメントの冒頭 200 文字などの短い文だけ (設計の中身そのものは送らない。コメントの文は、書いた人が外へ出ることを承知しているものとして送る)。URL は画面にもホスト名だけを出す。
- 守り (`ops/notifySend.ts`): **https のみ**・URL に資格情報を含めない・IP アドレスの直接指定とローカルのホスト名は不可。名前解決の結果が、社内・ローカルのアドレス (10/8・172.16/12・192.168/16・127/8・169.254/16・100.64/10・IPv6 のローカル) のどれか 1 つでも含むなら送らない。**検査したアドレスへそのまま接続する** (DNS リバインディング対策)。リダイレクトは追わない・10 秒・応答は 64 KB まで。
- 失敗しても、元の操作は止めない (サーバのログに残す)。「テスト送信」は、確認のあとに、実際に外へ送る (管理者)。
- 「要確認の増加」: 設計を変えたあと、30 秒まとめて、要確認 (エラー + 警告) の件数を数え、前回より増えていれば送る。受ける通知先があるときだけ計算する。

## 9. 変更の記録 (連携と運用 → 変更の記録)

`<ワークスペース>/.harmony-ops/audit.jsonl` (1 行 1 件の JSON)。日時・利用者・操作・対象・内容・経路 (画面 / AI)。

- 残るもの: 画面からの設計の保存・削除・改名・置換・編集内容の保存、設定の保存 (体裁・権限・通知先・点検の抑制)、承認の操作、コメント、コミット、ブランチの操作、AI の書き込みの tool (利用者は「AI」)。確認だけの要求 (編集セッションの衝突の確認) は残さない。
- 2 MB を超えたら 1 世代だけ退避する (`audit.1.jsonl`)。書けなくても、元の操作は止めない。利用者・操作・語・期間で絞れる。CSV で保存できる。個人の記録なので、git には載らない。

## 10. 取り込み (連携と運用 → 取り込み、貼り付けの画面)

どれも、まず**予行** (何が作られるか・既にあるものは作らない・読み飛ばしたもの・注意) を見せ、選んだものだけを新規に作る。既存の設計は上書きしない。

| 取り込み | 内容 |
|---|---|
| DDL → テーブル (`shared/src/importers/ddl.ts`) | `pg_dump -s` / `mysqldump --no-data` / 手書きの `CREATE TABLE`。列 (型・長さ・小数桁・NOT NULL・既定値・主キー・一意・自動採番 / SERIAL・コメント)、テーブル制約 (主キー・一意・外部キー・ON DELETE / UPDATE)、`CREATE INDEX`、`ALTER TABLE ADD CONSTRAINT`、`COMMENT ON`。**スキーマにない型は VARCHAR にし、元の型を備考に残す** (UUID は VARCHAR(36))。物理名は小文字の snake_case にし、直したものは注意に出す。読み飛ばすもの: トリガ・ビュー・関数・CHECK の式・式のインデックス。取り込んだテーブルは「下書き」。 |
| OpenAPI (JSON) → 処理フローの骨組み (`importers/openapi.ts`) | operation ごとに、入口 (メソッド・パス・認証)・入力 (パス・クエリ・本文の項目)・出力・応答の一覧。工程は空。同じ文書内の `$ref` だけ解決。YAML は読まない (JSON に変換してから)。500 operation まで。結果の大きさの上限: 1 つのスキーマは 200 項目・1 operation は 300 項目・全体は 5 万項目 (共通のスキーマを多数の operation から参照しても、小さな文書が巨大な結果にならないよう)。超えたら警告して打ち切る。 |
| Excel (.xlsx) の表 (`importers/xlsx.ts`) | テーブルの「カラムを貼り付け」・画面項目の「項目を貼り付け」の「Excel ファイルを読む」。シートを選び、貼り付けと同じタブ区切りにして入力欄へ。以後は、貼り付けと同じ予行・重複の確認。20 MB まで。 |

**対象外**: Excel の設計書全体 → 各定義への取り込み (カラム・画面項目の表だけ)。DB へ接続しての ER の取り込み (§12)。

## 10b. 設計の id の改名への追従

設計の id を改名する (画面・MCP の `rename_entity`) と、承認・レビューコメント・生成の記録の対象の id と、生成のときの設計の写しのファイル名を、新しい id に付け替える。取り消すと戻る。改名は設計の内容 (id) を変えるので、承認は「承認後に変更」、生成は「設計が変わった」と示される (確かめ直す合図)。記録が壊れていて付け替えられなくても、改名は止めない。

## 11. 生成の管理 (連携と運用 → 生成の管理)

`<データフォルダ>/generation.json` と `.harmony-ops/gen-snapshots/`。

1. AI がコードを生成したら、`designer__record_generation` で、生成したファイル (ワークスペースからの相対パス) と、元にした設計 (kind / id) を記録する。サーバが、元にした設計の**内容の印**と**生成のときの設計の写し**、生成物の**内容の印**を残す。
2. `designer__check_generation_drift` / 画面の「生成の管理」が、記録と現状を突き合わせる: 最新 / 設計が変わった (再生成が必要) / 生成物が書き換えられた / 両方が変わった (どちらを正とするか確認) / 生成物がない。設計が削除されたものは「削除」と示す。
3. `designer__get_regeneration_diff` / 画面の「設計の差分」が、生成のときの設計とのフィールド単位の差分 (追加・削除・変更の場所と前後の値、400 件まで) を返す。AI は、変わった箇所だけを再生成する。
4. 生成物の場所は、`base` (基準) と、そこからの相対パスで指す。基準は 2 つだけ: `workspace` (ワークスペース。既定) と `generated-code` (本体の `.tmp/generated-code/` = `/generate-code` の既定の出力先。環境変数 `HARMONY_GENERATED_CODE_DIR` で変えられる)。基準の中だけで、`..`・絶対パス・隠しフォルダ・シンボリックリンクの先が外のものは不可 (内容の印だけを読み、内容は返さない)。基準の外 (別のフォルダ) に出力したときは、記録はできるが、書き換えの検出はしない。同じパスでも、基準が違えば別のファイル。

## 12. 実装しないもの (理由)

| 項目 | 理由 |
|---|---|
| リアルタイム共同編集 (#87) | 保留中の #855 の方針 (競合の解決・スキーマ) が決まっていない。排他編集 + 閲覧の同時表示は、既にある |
| DB からの ER の取り込み (#93) | ドライバの依存と、接続情報の扱いの判断が要る。代わりに、DDL の取り込み (§10) で `pg_dump -s` / `mysqldump --no-data` の出力を取り込める |
| AI レビューの自動実行 (#94 の一部) | 保存時・要求時に AI を自動で動かす仕組みは作らない (AI の実行は、利用者が Codex / Claude Code で始める)。AI が見つけた指摘を、位置つきのコメントとして残す経路 (§5) だけを用意した |
| 技術スタックの選択肢そのものの追加 (#96 の一部) | 選択肢は、スキーマ (`harmony.v3.schema.json`) の列挙値で、足すにはスキーマの変更 (設計者の判断) が要る。プリセット (既存の選択肢の組み合わせ) だけ追加した |
| PDF の自前生成 (#81 の一部) | 日本語フォントの埋め込みが要る。ブラウザの印刷 → PDF で足りる |
| インストーラ・配布イメージの公開 (#98 の一部) | 配布の判断。`npm run setup` と、既存の Dockerfile・compose で足りる範囲 |

## 13. 技術スタックのプリセット (技術スタック画面)

`frontend/src/utils/techStackPresets.ts`: Java (Spring Boot + PostgreSQL / Oracle + Thymeleaf)・Kotlin・TypeScript (NestJS + Next.js / Express)・Python (FastAPI + Vue / Nuxt)・Go (Gin + Kubernetes) の 7 つ。バックエンド・DB・フロントエンド・認証・デプロイをまとめて入れる (画面デザインの設定は変えない。保存するまで確定しない)。すべて、スキーマの列挙値と、組み合わせの制約 (`techStackConstraints.ts`) を満たす (試験で確認)。規約 (`@conv.*`) の既定値は含まない。

## 14. 版・リリースノート・初回セットアップ・資料の鮮度

- **版** (連携と運用 → 版と更新): ルートの `package.json` の version・git のコミット (短縮 SHA)・ブランチ・コミットしていない変更の有無・サーバの起動時刻。「更新を確認する」は、押したときだけ、最新の main を読み取りで問い合わせる。git の作業コピーは更新元 (origin) へ `git ls-remote` (毎回問い合わせる。覚えない。`git pull` のすぐあとに押しても新しい結果が出る)。**更新の案内**: 前回このブラウザで見た版・コミットと違えば、通知で知らせる (初回は知らせない。localStorage)。
- **配布 image の版の記録** (#1577): 配布 image は git の作業コピーではない (`.git` を持たない)。`scripts/build-harmony-image.sh` が、作った時点の commit (完全な SHA)・ブランチ・コミットしていない変更の有無・作った日時 (UTC)・取得元 (`origin` の URL から GitHub の `owner/repo`。GitHub でなければ空) を build-arg で渡し、Dockerfile が OCI の label (`org.opencontainers.image.revision` / `created` / `source`) と `/app/build-info.json` (`{ commit, branch, dirty, builtAt, repo }`。空の項目は書かない) に残す。backend は、git の作業コピーでないとき `build-info.json` を読み (commit が 40 桁の 16 進でなければ全体を無視。ほかの項目も形が合うものだけ使う)、`VersionInfo` に `source: "git" | "image"`・`commitFull`・`builtAt`・`repo` を足す。
  - **更新の確認 (配布 image)**: `GET https://api.github.com/repos/<repo>/compare/<commit>...main?per_page=1` (認証なし・読み取りだけ・10 秒で打ち切り・押したときだけ。使うのは `status` / `ahead_by` / `behind_by` だけなので、commit・files の一覧は `per_page=1` で小さくする)。確かめられた結果 (最新・古い) は、**配布 image の経路だけ** **60 秒** 覚える (認証なしは 1 時間に 60 回までなので、画面や AI が続けて確認しても使い切らない。失敗は覚えず、すぐ再試行できる)。`repo` (`^[\w.-]+/[\w.-]+$`、`.` / `..` だけの部分は除く) と `commit` は形を検査してから URL に入れる。`identical` → 最新 / main が進んでいる (compare の `ahead_by` > 0) → `behind`「main より N commit 古い」(`behindBy`。分岐していれば main にない commit の数 `aheadBy` も添える) / image 側だけが進んでいる → `current`「main より先に進んでいます」/ 404 → 「記録した commit が GitHub にありません (push していないブランチから作った image など)」/ 403・429 → 「GitHub の問い合わせの回数制限か、アクセスの制限です。しばらくしてから」/ ネットワークの失敗 → 「確かめられません (fetch failed: ENOTFOUND api.github.com …)」のように `cause` の理由 (名前解決・証明書・プロキシなど) と、時間切れ (10 秒) の案内を添える / それ以外 → 「確かめられません (…)」。
  - **画面**: 配布 image なら「配布 image」・commit・作った日時・取得元を出し、**ブランチが main でない / ブランチを特定できない (detached HEAD。`HEAD` はブランチ名として扱わない) / コミットしていない変更つき**は ⚠ の注意文で出す (作った人が、古いブランチの image を使っていると気づけるように)。
  - **MCP**: `designer__workspace_status` と `designer__get_project_context` に `harmony` (`version`・`commit`・`branch`・`dirty`・`builtAt`・`source`。ネットワークは使わない)。読み取りの tool `designer__check_harmony_update` が、画面の「更新を確認する」と同じ確認をする (GitHub への問い合わせは、この tool を呼んだときだけ。ワークスペースが開いていなくても使える)。
- **開発コンテナの雛形の更新** (#1577): generate-code が写す雛形 (`ai-skills/generate-code/templates/devcontainer/<組合せ>/`。Harmony 本体の image にも入っている) が新しくなったとき、アプリ側に知らせ、AI が当てる。実装: `backend/src/ops/scaffold.ts`。
  - **雛形の版**: 組合せのフォルダの全ファイルを相対パス (`/` 区切り) の順に並べ、「パスと中身 (CRLF は LF にそろえる)」の SHA-256 の先頭 12 桁。人が版を上げ忘れない。組合せは、記録があれば記録、無ければ `harmony.json` の `techStack.backend.framework` (spring-boot / nestjs) × `techStack.frontend.library` (thymeleaf / react) で決める (generate-code の表と同じ 4 つ)。
  - **対象と行き先**: 雛形のフォルダにあるファイルすべて。`.devcontainer/devcontainer.json`・`.devcontainer/compose.yml`・`.mcp.json`・`.tmp/.gitignore` はワークスペースのルート、`Dockerfile`・`docker-compose.yml` は出力先 (`outDir`、既定 `.`)、`README.snippet.md` は出力先の `README.md` の節 (`kind: "section"`)。
  - **記録** `design/scaffold.json` (データフォルダ。git に載る。`generation.json` と同じ作法で、読み込みのたびに検証し、壊れた項目は「読み込み」の warning で知らせる): `{ combo, outDir, templateVersion, recordedAt, files: [{ template, path, kind, content?, skipped? }] }`。`content` は写したときの**雛形の**中身で、backend が雛形から読んで書く (AI に渡させない)。既存のため写さなかったファイルは `skipped` (中身なし = 2 方向)。設計の schema ではなく運用の記録。雛形の置き場は、資料の置き場 (`HARMONY_DOCS_DIR`。`harmony://skill/...` が読む場所) に従う。記録のファイルは 50 件まで (超えた分は読まず、「読み込み」の warning で知らせる)。外部の変更 (git pull・手編集) は `opsChanged` で画面に知らせる。
  - **知らせる**: `designer__check_design` の info (「開発コンテナの雛形」。error / warning ではないので ok には影響しない)・`designer__get_project_context` の `scaffold` (status・組合せ・版。`not-applicable` のときは理由の文 `reason` と、種類 `reasonCode`: `tech-stack-undecided` = 組合せが決まらない / `no-scaffold-record` = 記録も image の指定も無い / `template-missing` = 記録の組合せの雛形が見つからない / `image-not-used` = 記録も Harmony の image を使う compose.yml も無い。AI や画面は文でなくこの値で分岐する)・画面「版と更新」の節「開発コンテナの雛形」(状態・版・「AI に『開発コンテナの雛形の更新を取り込んで』と頼む」)。画面は、AI が記録を書き直した (`opsChanged`) あとも、開いたまま読み直す。点検の info は、設計のデータ・ルートの `compose.yml` が変わらないあいだ前の結果を使う。記録があり版が違えば「新しくなっています (記録 X → いま Y)」、記録が無くても、ルートの `.devcontainer/compose.yml` の `image:` の行 (`${HARMONY_IMAGE:-…}` の既定値を含む。コメントや `harmony-xxx` など別の image は除く) が Harmony の image (`ghcr.io/csilost2001/harmony`) を指していれば「記録がありません」。どちらにも当てはまらないワークスペースには何も出さない。
  - **当てる**: `designer__get_scaffold_update` が、ファイルごとの `state` と、変わったファイルの `base` / `app` / `latest` / `appEdited`・手順 `guide` を返す。**人に見せる差分** (AI が自分で差分を作らない): `diff` (いまのアプリ → 新しい雛形)・base があるとき `templateDiff` (雛形の変更) と `appChanges` (利用者の手入れ) を、前後 3 行の文脈つきの unified diff (`--- a/<path>` `+++ b/<path>` `@@ -l,n +l,n @@`。LCS の行差分を `backend/src/ops/lineDiff.ts` に持つ。改行は LF にそろえる。末尾の改行の有無は `\ No newline at end of file`) で返す。片方が 3000 行を超えるファイルは差分を作らず `diffTooLarge: true`、差分が 200KB を超えるときは行の境界で切って `diffTruncated: true`。**README の節** (`kind: section`): `app` は README 全体のままだが、README から節を切り出して `appSection` (snippet の最初の見出しの行と同じ行から、同じか上のレベルの次の見出しの前まで。README の終わりまで続くことも。コードブロックの中の見出しは数えない。末尾の空行は含めない。無ければ null)・`sectionHeading`・`appSectionRange` (`startLine` / `endLine`、1 始まり) を返す。差分 (`diff` / `appChanges`) と `appEdited` / 記録なしの「同じか」は、この節の範囲で見る (README の他の部分の違いは出ない。見出しの無い snippet は README 全体)。AI は `appSectionRange` の範囲だけを新しい節で差し替える。記録のあるファイルは 3 方向 (base→latest が雛形の変更、base→app が利用者の手入れ)、記録の無い・飛ばしたファイルは 2 方向 (`appEdited: null` = 手入れかどうか不明)。AI は、利用者が手を入れた箇所 (Harmony の image の版・足した service・ポートなど) を残し、差分を利用者に見せて OK を取ってから書き、当てたら `designer__record_scaffold` (**当てなかったファイルは必ず `skipped` に渡す**。渡さないと、そのファイルの「写したときの中身」が最新の雛形に置き換わり、次の更新で手入れと雛形の変更を取り違える)、`.devcontainer/` を変えたら Rebuild Container を頼む。backend は書き換えない (読み取りのみ)。
- **リリースノート**: `npm run release:notes` が、git の履歴 (first-parent の 1 コミット = 1 行) から `docs/release-notes.md` を作る。画面は、新しい 30 件を出す。
  - **配布 image のリリースノートは、image を作るときの履歴から作る** (#1577): commit 済みのファイルは「その PR 自身の題名」を含められず、いつも 1 つ遅れる。`scripts/build-harmony-image.sh` が `node scripts/release/notes.mjs --ref HEAD --stdout` で作った内容を一時フォルダに書き、名前つき build context `releasenotes` で渡す。`Dockerfile` の `FROM scratch AS releasenotes` の段 (既定は commit 済みの `docs/release-notes.md`) が、これに差し替わり、runtime の段が `COPY --from=releasenotes` で `docs/release-notes.md` に写す。`docker build` だけで作った image、git・node が無いとき、`--build-context` に対応しない engine (docker / podman の古い版) では渡さず、注意を出して commit 済みのファイルになる。ブランチから作ると、ブランチの commit の題名も並ぶ (作ったブランチは「版の記録」で分かる)。git の作業コピーで動かす Harmony の画面は commit 済みのファイルを読むので、定期的に `npm run release:notes -- --ref origin/main` で作り直す。
- **初回セットアップ**: `npm run setup` が、Node の版・git・ポートの使用を診断し、足りないもの (npm install・`@harmony/shared` のビルド・`workspaces/`) をそろえて、起動のしかたを案内する。`-- --check` は診断だけ、`-- --sample retail` はサンプルの複製。
- **資料の鮮度検査** (`npm run check:docs`。`npm run check` に含まれる): 資料の相対リンクの先・`npm run` の名前・AGENTS.md の Routing の表と画面の経路 (両方向)・UI 操作リファレンスの対象画面のファイル / ルート / スクリーンショット・CLAUDE.md のスキル表を、実物と突き合わせる。知らせるだけ (`-- --info`): UI 操作リファレンスのない画面・古くなったスクリーンショット (git の履歴で、画面のコードの最後の変更と比べる)・仕様書の索引にない仕様書。`npm run docs:shots` が、対応表のある画面のスクリーンショットを撮り直す。**限界**: 画面の文言 (ボタンの名前など) の食い違いは、検出しない。

## 15. RPC / MCP tool

| 種類 | 名前 |
|---|---|
| RPC (画面。`backend/src/wsHandlers/ops.ts`) | `documentTemplate.load` `documentTemplate.save` `revisions.suggest` `approvals.load` `approvals.transition` `reviewComments.load` `reviewComments.add` `reviewComments.resolve` `access.load` `access.save` `audit.list` `notify.load` `notify.save` `notify.test` `git.status` `git.diff` `git.log` `git.branches` `git.commit` `git.checkout` `git.init` `generation.status` `generation.diff` `app.version` `app.checkUpdate` `scaffold.status` |
| 通知 (broadcast) | `opsChanged` (承認・コメント・権限・体裁・生成の記録・通知先・Git の変更。AI の書き込みと、ファイルの外部更新も) |
| MCP tool (書き込み。読み取り専用モードでは使えない) | `designer__record_generation` `designer__add_review_findings` `designer__record_scaffold` |
| MCP tool (読み取り) | `designer__check_generation_drift` `designer__get_regeneration_diff` `designer__list_review_comments` `designer__check_harmony_update` `designer__get_scaffold_update` |

## 16. 試験

- 単体: `frontend/src/components/document/officeExport.test.ts` (zip・HTML ブロック・docx / xlsx・体裁・図)、`backend/src/ddlImport.test.ts` / `importers.test.ts`、`backend/src/ops/ops.test.ts` (権限・承認・コメント・監査・生成の記録・通知の送信・Git・版・MCP tool)、`frontend/src/utils/techStackPresets.test.ts`、`scripts/verify/test.mjs` (資料の鮮度検査・setup・release:notes)
- E2E: `frontend/e2e/integration-ops.spec.ts`
