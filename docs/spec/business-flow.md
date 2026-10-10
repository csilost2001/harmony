# 業務フロー (スイムレーン) — 仕様書

**Status**: 実装済 (2026-10、再設計 段階 4)
**関連**: [docs/plans/redesign-2026-10.md](../plans/redesign-2026-10.md) / [design-document.md](design-document.md) / [layout-components.md](layout-components.md)

## 1. 目的

画面・処理フローより上の「業務の流れ」を、誰 (部門・役割・システム) が何をするかをレーン (スイムレーン) に分けて表す。要件定義〜基本設計の入口で、業務担当者と開発者が同じ図を見て合意するための設計書にする。

- 業務フローの工程から、実際の画面と処理フローへたどれる (どの工程がどの画面・処理で実現されるか)
- 図は**原本のデータから自動で配置**する (座標を持たない)。設計者は工程・レーン・つながりだけを編集し、見た目の整列は規則で決まる
- 設計書 (HTML) の章にも同じ図を出す

## 2. 原本

`<dataDir>/business-flows/<id>.json` (1 業務フローにつき 1 ファイル)。スキーマは [`schemas/v3/business-flow.v3.schema.json`](../../schemas/v3/business-flow.v3.schema.json)。`harmony.json` への登録は不要 (ディレクトリにあるものを一覧する)。

```jsonc
{
  "$schema": "../../../../schemas/v3/business-flow.v3.schema.json",
  "version": 1,
  "id": "order-to-shipment",          // kebab-case。ファイル名と一致
  "name": "注文から出荷まで",
  "description": "…",
  "maturity": "draft",                // draft / provisional / committed (任意)
  "lanes": [
    { "id": "customer", "name": "顧客", "kind": "external" },
    { "id": "store", "name": "店舗", "kind": "person", "roleRef": "staff" },
    { "id": "system", "name": "リテールシステム", "kind": "system" }
  ],
  "steps": [
    { "id": "start", "lane": "customer", "kind": "start", "name": "注文したい", "next": [{ "to": "search" }] },
    { "id": "search", "lane": "store", "kind": "task", "name": "商品を探す", "screenRef": "product-search", "next": [{ "to": "stock" }] },
    { "id": "stock", "lane": "store", "kind": "decision", "name": "在庫あり?", "next": [{ "to": "order", "label": "あり" }, { "to": "end", "label": "なし" }] }
  ]
}
```

### 2.1 レーン

| 項目 | 内容 |
|---|---|
| `id` | レーン ID (camelCase。フロー内で一意) |
| `name` | 表示名 (部門名・役割名・システム名) |
| `kind` | `person` (人・部門) / `system` (システム) / `external` (外部の関係者・外部システム)。図の見た目と一覧の区別に使う。省略時は `person` |
| `roleRef` | 規約の役割 (`@conv.role.<key>` のキー)。権限の章とつなげる (任意) |

レーンは配列の順に上から並ぶ。

### 2.2 工程

| 項目 | 内容 |
|---|---|
| `id` | 工程 ID (camelCase。フロー内で一意) |
| `lane` | 実施するレーンの ID |
| `kind` | `start` 開始 / `task` 作業 / `decision` 判断 / `end` 終了 |
| `name` | 工程名 (図に出す短い名前) |
| `description` | 工程の説明 (任意。設計書に出す) |
| `screenRef` | 実現する画面の ID (任意) |
| `processFlowRef` | 実現する処理フローの ID (任意) |
| `next` | 次の工程 `[{ to, label? }]`。判断では分岐の条件を `label` に書く |

## 3. 図の自動配置

`shared/src/businessFlow.ts` の `layoutBusinessFlow` が決定的に配置する (同じ入力から同じ図)。

1. 開始工程 (なければ他の工程から入ってこない工程) を列 0 とし、`next` をたどって**最長経路の深さ**を列とする。戻る線 (ループ) は深さの計算から除く
2. 開始から到達できない工程は、最後の列のあとに並べる (要確認に出す)
3. 行は工程の `lane` で決まる。同じレーン・同じ列に複数の工程があるときはレーン内で縦に積む (レーンの高さが伸びる)
4. 線は直角に折れる線。戻る線は工程の下を回して描く。分岐の `label` は線の始点の近くに置く

図の出力は SVG 文字列 (`businessFlowToSvg`)。アプリの編集画面と設計書で同じ関数を使う。

## 4. 検証

保存は妨げず、要確認として表示する (draft-state の方針)。

| コード | 重大度 | 内容 |
|---|---|---|
| `duplicate-id` | error | 工程 ID / レーン ID が重複 |
| `unknown-lane` | error | 工程の `lane` が存在しない |
| `dangling-next` | error | `next.to` の工程が存在しない |
| `no-start` | warning | 開始工程がない |
| `no-end` | warning | 終了工程がない |
| `unreachable` | warning | 開始から到達できない工程 |
| `dead-end` | warning | 終了でない工程に次の工程がない |
| `end-with-next` | warning | 終了工程に次の工程がある |
| `decision-branches` | warning | 判断の分岐が 2 つ未満 |
| `decision-unlabeled` | info | 判断の分岐に条件 (`label`) がない |
| `unknown-screen` / `unknown-flow` / `unknown-role` | warning | 参照先の画面・処理フロー・役割が存在しない |

## 5. 操作 (UI)

- ヘッダーメニュー「業務フロー」→ 一覧 (`/business-flow/list`)。新規作成・複製・削除ができる
- 編集 (`/business-flow/edit/:id`): 左にレーンと工程の一覧、中央に図、右に選んだ工程の設定
  - 図の工程をクリックで選択。「次の工程を追加」で同じレーンに新しい工程を作ってつなぐ
  - 工程の設定: 名前・種類・レーン・説明・画面・処理フロー・次の工程 (条件つき)
  - 左の一覧の持ち手 (⋮⋮) をドラッグして、レーンと工程を並べ替えられる (行のクリックは選択のまま。キーボードではレーンの上へ / 下へのボタン)。工程の並びは、同じレーン・同じ列に積むときの上下の順になる
  - 保存は明示的に行う (編集中の「保存」。Ctrl+S も可)。開いただけでは原本を書き換えない。変更は元に戻す / やり直しができる
- 要確認 (検証結果) を図の下に表示する


### 5.1 編集セッション (同時に編集されたとき)

他の設計書 (テーブル・処理フロー等) と同じ編集セッション ([edit-session-protocol.md](edit-session-protocol.md)、resourceType `business-flow`) で編集する。

- 開いた直後は**閲覧のみ**。ヘッダー下の「編集開始」で編集セッションを作る (一覧から新規作成した直後は自動で始まる。複製は一覧にとどまるので、開いてから編集開始する)。編集中の内容はサーバ側の下書きに保たれ、ブラウザを閉じても、再び開くと「再開 / 破棄」を選べる
- 他の人・AI が同じ業務フローを編集中でも、閲覧はできる (右上の編集セッションの一覧から、閲覧で参加・編集の引き継ぎができる)。複数の編集セッションが並存した場合は、保存時に先に保存した人がいれば「上書きして保存」か「キャンセル」を選ぶ (後勝ち)
- 他 (AI の MCP 保存・別タブ・画面 / 処理フローの ID 改名による参照の書き換え) が保存すると、閲覧中は自動で読み直し、編集中は「別のクライアントでデータが変更されました」と知らせる (自分の変更は消さない。「再読み込み」で他の内容に取り替え、「無視」でそのまま保存できる)
- この業務フローが参照する画面・処理フローの ID 改名は、**この業務フローを編集中の別セッションがあると止められる** (編集中の下書きを古い参照のまま保存して、改名を巻き戻さないため)。編集を保存・破棄してから改名する
- 新規作成・複製は「すでにあれば失敗」(`[DOC_EXISTS]`)。別タブで同じ ID を先に作られても上書きしない。同じ文書への書き込みは 1 本ずつ行い、壊れた JSON は一覧に警告として出し (設計書にも載らない旨を警告)、保存するときは退避してから書く

## 6. AI (MCP) から

| ツール | 内容 |
|---|---|
| `designer__list_business_flows` | 業務フローの一覧 (id / 名前 / 工程数) |
| `designer__get_business_flow` | 1 件の原本 + 検証結果 |
| `designer__save_business_flow` | 1 件の保存 (スキーマ検証 + 検証結果を返す) |
| `designer__delete_business_flow` | 1 件の削除 |

## 7. 関連の追従

画面・処理フローの ID を改名すると、工程の `screenRef` / `processFlowRef` も追従する。

## 8. 設計書

「業務フロー」の章 (定義があるときだけ) に、フローごとの図・工程表 (工程 / レーン / 種類 / 画面 / 処理 / 次の工程) を出す。工程から画面・処理の節へリンクする。
