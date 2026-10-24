---
description: "「この項目は、どの種類の設計を指す id か」をスキーマで宣言する (x-ref-kind)。参照の検査・資料は同じ宣言から作る"
status: decided
decidedBy: "設計者 (2026-10-24 に承認。AI が提案 [docs/plans/schema-proposals-2026-10.md] を出した)"
confirmation: "設計者が承認 (2026-10-24)"
period: "2026-10"
---

# 0009 参照の種類をスキーマで宣言する (`x-ref-kind`)

**状況**: 「`tableId` はテーブルを指す」といった対応が、参照元の検索・改名・付け替え・影響分析・参照の整合の検査で、それぞれ別々にコードの中に書かれていた。スキーマに参照の場所が増えると、どれかが取り残され、実際に検査の穴が 8 つ見つかっていた ([ADR 0005 の検査の回帰試験](../spec/design-check.md))。

**決めたこと**: スキーマ (`schemas/v3/*.json`) の、id を持つ項目に `"x-ref-kind": "<種類>"` を足す。種類は、設計そのもの (`table` `screen` `processFlow` `view` `viewDefinition` `pageLayout` `screenGroup`) と、ある設計の中の id (`column` `action` `response` `step` `screenItem` `screenEvent`)。配列の項目は `items` に付ける。注釈だけで、検証の動作は変わらない (AJV の strict は無効)。

- 注釈から `docs/spec/schema-refs.json` と `shared/src/analysis/refKinds.generated.ts` を**自動生成**する (`node scripts/docs/generated.mjs --write`。ずれると `npm run check:docs` が止める)
- 最初の消費者は、設計どうしの参照の整合の検査 (`shared/src/analysis/integrity.ts`): 宣言された項目は、どこに書かれていても (テストの前提データの中でも)、ないテーブル・画面・処理フローを指せば指摘する。新しい参照の項目は、スキーマに注釈を足せば検査される
- 改名・付け替え・参照元の検索は、いまのコードのまま動く。順に、注釈を読む形へ移す (移行の途中でも壊れない)

**理由**: 参照の宣言を 1 か所にすれば、新しい参照を足すときの取りこぼしがなくなる。注釈なので、既存の設計・生成コード・画面は影響を受けない。

**選ばなかった案**: コードの表を手で保つ (取りこぼしが起きる) / `oneOf` + discriminator や `$ref` の型を種類ごとに分ける (EntityId を型で割ると、スキーマの変更が大きく、拡張の工程と両立しない)。

**結果**: `frontend/src/utils/integrity.test.ts` が、宣言された項目ごとに「ないものを指せば指摘される」ことを見張る。同じ項目名で種類が複数あるときは、あいまいなので検査しない (いまは該当なし)。同時に承認された小さな追加: `outputBinding.shape` ([process-flow-variables.md](../spec/process-flow-variables.md))、ドメインの `unit` / `rounding` ([process-flow-extensions.md](../spec/process-flow-extensions.md))。
