// 開発コンテナの雛形の更新の MCP tool の定義 (#1577 第 2 部)。tools.ts が行数の予算に達しているので分けた (tools.ts の `...workspaceTools,` の隣に展開する)。
export const scaffoldTools = [
  {
    name: "designer__record_scaffold",
    description:
      "開発コンテナの雛形 (generate-code の templates/devcontainer/<組合せ>/) を写した・更新を当てたあとに、「いまの雛形の版」で記録 (design/scaffold.json) を書き直します。" +
      "雛形の中身は backend が雛形から読んで記録します (渡す必要はありません)。写さなかった・当てなかったファイルは**必ず** skipped に雛形のパスで渡します (省略は前回のまま、空配列で解除)。" +
      "渡さなかったファイルは、記録の「写したときの中身」が最新の雛形に置き換わるので、当てていない変更が次の更新の差分から消えます (記録を書き直す操作です)。",
    inputSchema: {
      type: "object" as const,
      properties: {
        combo: { type: "string", enum: ["spring-boot-thymeleaf", "spring-boot-nextjs", "nestjs-thymeleaf", "nestjs-nextjs"], description: "雛形の組合せ。省略は、前回の記録、無ければ harmony.json の techStack (backend.framework × frontend.library) から決めます。" },
        outDir: { type: "string", description: "本番用の Dockerfile・docker-compose.yml・README.md を置いた出力先 (ワークスペースからの安全な相対パス。省略は前回の記録、無ければ \".\")。" },
        skipped: { type: "array", items: { type: "string" }, description: "既存のため写さなかった・当てなかったファイルの、雛形のパス (例: \"Dockerfile\"、\".devcontainer/compose.yml\")。" },
      },
      required: [],
    },
  },
  {
    name: "designer__get_scaffold_update",
    description:
      "開発コンテナの雛形に更新があるか、あれば差分の材料を返します (読み取りのみ)。status: current (最新) / outdated (雛形が新しくなった) / no-record (記録が無い。Harmony の image を使う .devcontainer/compose.yml があるとき) / not-applicable (該当しない)。" +
      "files[] は雛形が書くファイルごとに、state (unchanged / template-changed / new-in-template / removed-from-template)・base (写したときの雛形。無ければ 2 方向)・app (いまのアプリのファイル)・latest (新しい雛形)・appEdited を返します (中身は変わったファイルだけ、1 ファイル 200KB まで)。" +
      "guide に当て方の手順があります。利用者に差分を見せて OK を取ってから書き、当てたら designer__record_scaffold を呼んでください。",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
];
