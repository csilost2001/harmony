# プロジェクト独自部品 (layout components) — 仕様書

**Status**: 実装中 (2026-10、再設計 段階 1 の続き)
**関連**: [screen-layout.md](screen-layout.md) / [design-document.md](design-document.md) / [docs/plans/redesign-2026-10.md](../plans/redesign-2026-10.md) / [schema-governance.md](schema-governance.md)

## 1. 目的

業務部品 (入力フォーム・一覧表・ボタン群 等) の組み合わせのうち、プロジェクトの中で繰り返し使うもの (例: 「キーワード検索パネル」「注文サマリ」「承認ボタン群」) に名前を付けて登録し、どの画面にも 1 つの部品として置けるようにする。

- JSON を手で書かなくても、**画面デザイナで組んだ部品を選んで登録する**だけで作れる (WYSIWYG)
- 画面ごとに変える箇所 (画面項目・文言・遷移先) は「差し込み口」として決めておく
- 定義を直すと、使っているすべての画面に反映される (コピーが散らばらない)
- 旧エディタ (GrapesJS / Puck) のカスタムブロック・登録コンポーネントに代わる仕組み

外部の React コードで動く部品は対象外 (WYSIWYG では作れない)。設計書では「部品の名前・差し込み口・見た目の仕様」だけを定義し、実装はコード生成の段階で扱う。

## 2. データ形式

### 2.1 定義: `<dataDir>/layout-components.json` (プロジェクト共通)

schemas/v3/layout-components.v3.schema.json。

```json
{
  "$schema": "../schemas/v3/layout-components.v3.schema.json",
  "version": 1,
  "components": [
    {
      "id": "keyword-search",
      "label": "キーワード検索",
      "category": "検索",
      "description": "キーワード 1 つで絞り込む検索パネル",
      "params": [
        { "id": "title", "label": "表題", "kind": "text", "default": "検索条件" },
        { "id": "keyword", "label": "キーワード項目", "kind": "item" },
        { "id": "searchButton", "label": "検索ボタン", "kind": "item" }
      ],
      "nodes": [
        { "id": "panel", "type": "search-panel", "props": { "title": "{{title}}" }, "children": [
          { "id": "keywordField", "type": "field", "itemRef": "{{keyword}}" },
          { "id": "bar", "type": "button-bar", "props": { "align": "right" }, "children": [
            { "id": "go", "type": "button", "itemRef": "{{searchButton}}", "props": { "variant": "primary" } }
          ] }
        ] }
      ]
    }
  ]
}
```

- `nodes` は screen.v3 の `LayoutNode` と同じ形の部品の木 (テンプレート)
- 差し込み口 (`params`) の種類:

| kind | 差し込み先 | 画面側 `args` の値 |
|---|---|---|
| `text` | 部品の `props.title / text / label / html / src / alt` (文字列の一部でも可) | 文言 |
| `item` | `itemRef` (値全体が `{{id}}`) | 画面の `items[].id` |
| `screen` | `props.screenRef` | 画面 id |

- テンプレート内の `{{paramId}}` が、画面側の `args[paramId]` (無ければ `default`) で置き換わる。`text` の未指定は空文字、`item` / `screen` で `args` も `default` も無いと警告
- 独自部品の中に別の独自部品 (`type: "component"`) を入れ子にできる。入れ子は 5 段まで、循環は不可

### 2.2 参照: 画面の `layout` に置く部品 (`type: "component"`)

```json
{ "id": "productSearch", "type": "component", "componentRef": "keyword-search",
  "args": { "title": "商品を探す", "keyword": "productName", "searchButton": "searchButton" } }
```

- `componentRef`: 定義の `id`。`args`: 差し込み口に入れる値
- 画面項目の定義は従来どおり画面の `items[]` に置く。独自部品の中の `field` / `table` / `button` は、`args` で渡された項目 id を介して `items[]` を参照する (項目定義の一元化は変わらない)
- 置ける場所: 画面の最上位、`section` / `form` / `search-panel` / `column` / `tab` の中 (`button-bar` / `columns` / `tabs` の直下は不可)

## 3. 展開

描画・検証・設計書出力のときは、参照部品を定義で展開した通常の部品の木にしてから扱う (`expandLayout` / `expandComponentNode`、shared/src/layoutComponents.ts)。

- 展開後の部品 ID は `<参照部品の ID>__<定義内の部品 ID>`。展開後の部品に起きた問題は、画面上の参照部品の問題として報告する
- 元の木は書き換えない。展開は決定的で、同じ入力から同じ結果になる
- 「展開して通常の部品にする」は、展開結果を画面の部品として直接置き、定義とのつながりを切る (ID は画面内で重ならないよう振り直す)

## 4. UI

### 4.1 画面デザイナ (`/screen/design/:screenId`)

- 左パレット「部品」タブの下に「独自部品」の区画。ドラッグ / クリックで置く。「独自部品の管理…」で管理画面を開く
- キャンバスでは定義を展開して表示する (点線の枠と名前付き)。中の部品は選択・移動できず、参照部品ごと 1 つとして扱う
- 右パネル (参照部品を選択): 差し込み口ごとの入力 (文言 = 入力欄 / 画面項目 = 画面項目の選択 / 遷移先 = 画面の選択)、「定義を編集」、「展開して通常の部品にする」
- 右パネル (通常の部品を選択): 「独自部品として登録…」。名前・ID・分類・説明と、差し込み口にする箇所 (参照している画面項目は既定で選択、文言・遷移先は任意) を選んで登録する。登録すると元の部品は参照部品に置き換わる
- 画面項目の「配置済み」判定には、独自部品の中で `args` 経由で使われている項目も含める

### 4.2 管理・編集 (モーダル)

- 一覧: 名前・ID・差し込み口の数・使用箇所 (画面数 / 部品数)。新規作成 (名前と ID)・編集・削除。使用中の部品は削除前に使用箇所を示して確認する
- 編集: 画面デザイナと同じパレット・キャンバス・詳細パネル。差し込み口 (画面項目) はキャンバス上で仮の項目「{{id}}」として扱い、パレットの「項目」から入力欄・一覧・ボタンにドラッグして割り当てる。文言は部品を選んで「差し込み口を使う」から入れる。未選択時の右パネルで差し込み口 (表示名・ID・種類・既定値) と分類・説明を編集する
- 保存済みの差し込み口の ID と種類は変えられない (使っている画面の `args` が参照するため)。追加は自由
- 取り消し / やり直し、未保存の変更がある状態で閉じるときの確認あり

### 4.3 保存と同時編集

定義は 1 件ずつ保存する (backend が「読む → 差し替える → 書く」を直列に行う)。別の部品の編集を上書きしない。同じ部品を複数人が同時に保存した場合は後勝ち。編集セッション (排他ロック) は使わない。

## 5. 検証 (保存は妨げない: draft-state)

| 対象 | コード | 重大度 |
|---|---|---|
| 画面 | `unknown-component` 定義が見つからない / `component-cycle` 循環 / `component-depth` 入れ子が深い | error |
| 画面 | `missing-arg` 差し込み口 (画面項目・遷移先) が未設定 / `missing-screen` 遷移先の画面が存在しない (画面一覧が分かるとき) | warning |
| 画面 | `invalid-child` 参照部品を置けない場所 | error |
| 定義 | `duplicate-component` ID 重複 / `bad-component-id` kebab-case でない / `duplicate-param` 差し込み口の ID が重複・不正 / `undeclared-param` 未定義の差し込み口を使っている / `component-cycle` / `invalid-child` | error |
| 定義 | `unused-param` 使われていない差し込み口 | warning |

展開後の部品の木には、通常の `validateLayout` (項目の存在・必須割当・未配置の項目 等) をそのまま適用する。

## 6. 改名との関係

| 改名するもの | 画面の `layout` | 独自部品の `args` |
|---|---|---|
| 画面項目 ID (`designer__rename_screen_item` / UI の ID 変更) | 通常の部品の `itemRef` を更新 | 差し込み口の種類が `item` のものだけ更新 (文言の `args` は触れない) |
| 画面 ID (entity rename) | button / link の `props.screenRef` を更新 | 差し込み口の種類が `screen` のものだけ更新 (種類が `text` / `item` の値は、同じ文字でも触れない)。独自部品の定義 (`layout-components.json`) の、種類 `screen` の既定値と、定義の中で他の独自部品を使う `args` も更新する。種類が分からない (定義が無い) 値は触れず、存在しない遷移先は検証で警告 (`missing-screen`)。元に戻すと定義も戻る |
| 独自部品 ID | 未対応 (登録後は変えられない) | — |

定義の中の項目参照は常に `{{差し込み口}}` なので、画面項目の改名は定義に影響しない。

## 7. AI 向け MCP ツール

| ツール | 内容 |
|---|---|
| `designer__get_screen_layout` | 画面の layout / items / 検証結果 |
| `designer__set_screen_layout` | layout (と任意で items) を保存。検証結果は保存を妨げず返す |
| `designer__list_layout_components` | 独自部品の定義一覧 (使用箇所・定義の検証結果つき) |
| `designer__save_layout_component` | 1 件追加 / 置換。定義にエラーがあると保存しない |
| `designer__delete_layout_component` | 削除。使用中は `force: true` が必要 |

## 8. 設計書・コード生成との関係

- 設計書ビュー / HTML 出力は、画面レイアウトを展開して描く。章「独自部品」に定義の一覧・差し込み口・使用箇所を出す (docs/spec/design-document.md)
- `/generate-code` は展開後の部品の木を画面構造の一次情報として読み、独自部品は再利用可能なコンポーネントとして生成する
