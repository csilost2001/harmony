#!/usr/bin/env node
/**
 * scripts/scaffold/puck-component.mjs — 外部 Puck Component scaffold (#1409 P-1)。
 *
 * 外部業務 React Component を Harmony Puck に読み込ませる雛形プロジェクトを生成する。
 * React / ReactDOM / @measured/puck は host (Harmony frontend) と共有する契約のため
 * external 扱いとし、bundle には含めない (import map + window bridge で host が供給する)。
 *
 * 使い方:
 *   node scripts/scaffold/puck-component.mjs <name> [--from-primitive <PrimitiveName>] [--out <dir>]
 *
 *   <name>               生成する component / package 名 (例: order-summary)
 *   --from-primitive X   frontend/src/puck/primitives/X.tsx を出発点にコピー (簡易化あり)
 *   --out <dir>          出力先ディレクトリ (省略時 ./<name>。data/ への直書きはしない)
 *
 * 生成物 (<out>/<name>/):
 *   package.json / vite.config.ts / tsconfig.json / src/<Name>.tsx / manifest.json / README.md
 *
 * build → dist/<name>.mjs 生成 → workspace の <dataDir>/puck-components/ に dist/ と
 * manifest.json を配置すると Harmony が runtime ESM import で読み込む。
 *
 * RFC #1405 シリーズ P-1。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// scripts/scaffold/ → scripts/ → repo root
const REPO_ROOT = path.resolve(__dirname, "../..");
const PRIMITIVES_DIR = path.join(REPO_ROOT, "frontend/src/puck/primitives");

function parseArgs(argv) {
  const args = { name: undefined, fromPrimitive: undefined, out: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from-primitive") {
      args.fromPrimitive = argv[++i];
    } else if (a === "--out") {
      args.out = argv[++i];
    } else if (a.startsWith("--")) {
      throw new Error(`不明なオプション: ${a}`);
    } else {
      rest.push(a);
    }
  }
  args.name = rest[0];
  return args;
}

/** kebab-case / snake_case → PascalCase */
function toPascalCase(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function writeFile(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  console.log(`  生成: ${path.relative(process.cwd(), full)}`);
}

function buildPackageJson(name) {
  return JSON.stringify(
    {
      name: `@harmony-external/${name}`,
      version: "0.1.0",
      type: "module",
      private: true,
      scripts: {
        build: "vite build",
      },
      devDependencies: {
        vite: "^6.0.0",
        "@vitejs/plugin-react": "^4.3.0",
        typescript: "^5.6.0",
        "@types/react": "^19.0.0",
        react: "^19.2.4",
        "react-dom": "^19.2.4",
        "@measured/puck": "^0.20.2",
      },
    },
    null,
    2,
  ) + "\n";
}

function buildViteConfig(name, pascal) {
  return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 外部 Puck Component の build 設定 (#1409 P-1)。
// react / react-dom / @measured/puck は host (Harmony) と共有するため external 化し、
// bundle に含めない。host は index.html の import map + window bridge でこれらを供給する。
// predicate 形式で subpath (react-dom/client, react/jsx-runtime, @measured/puck/* 等) も
// 漏れなく external 化する。
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/${pascal}.tsx",
      formats: ["es"],
      fileName: () => "${name}.mjs",
    },
    rollupOptions: {
      external: (id) => /^(react|react-dom|@measured\\/puck)(\\/.*)?$/.test(id),
    },
  },
});
`;
}

function buildTsConfig() {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n";
}

/**
 * primitive ソースを出発点にする場合、host 固有依存 (useCssFramework / layoutPropsMapping)
 * を import しない簡易版に変換する。完全移植は README で external 化の方針を案内する。
 */
function buildComponentFromPrimitive(pascal, primitiveName) {
  const src = path.join(PRIMITIVES_DIR, `${primitiveName}.tsx`);
  if (!fs.existsSync(src)) {
    throw new Error(
      `primitive が見つかりません: ${src}\n` +
        `frontend/src/puck/primitives/ 内の名前 (例: Card / Button) を指定してください。`,
    );
  }
  const original = fs.readFileSync(src, "utf-8");
  return `// ${pascal}.tsx — frontend/src/puck/primitives/${primitiveName}.tsx を出発点に scaffold (#1409 P-1)。
//
// 注意: 元の primitive は host 内部の useCssFramework() / layoutPropsMapping に依存します。
// 外部 component では host と共有されないため、以下いずれかで対応してください:
//   (1) 必要な class を props で受け取り単純化する (推奨、最小構成)
//   (2) host が将来 export する Context を import map に追加して共有する (P-3 以降)
// 下記は (1) の最小サンプルです。元ソースは末尾のコメントを参照してください。
import * as React from "react";

export interface ${pascal}Props {
  title?: string;
  className?: string;
  children?: React.ReactNode;
}

export default function ${pascal}({ title, className, children }: ${pascal}Props) {
  return (
    <div data-external-component="${pascal}" className={className}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * 元 primitive ソース (${primitiveName}.tsx) — 移植時の参考用:
 *
${original
    .split("\n")
    .map((l) => ` * ${l}`)
    .join("\n")}
 * ───────────────────────────────────────────────────────────────────────── */
`;
}

function buildComponentSample(pascal) {
  return `// ${pascal}.tsx — 外部 Puck Component サンプル (#1409 P-1 / slot 対応 #1411 P-3)。
//
// props は manifest.json の props 宣言と対応させてください。
// React は host と共有されるため、必ず "react" から import します (import map で解決)。
import * as React from "react";

export interface ${pascal}Props {
  /** 見出し */
  title?: string;
  /** 本文 */
  message?: string;
  /**
   * named slot (editable region) の render-prop。manifest の slots 宣言と対応します。
   * host (Harmony) が Puck の slot field を render-prop に変換して注入するため、
   * 外部部品側で DropZone を import する必要はありません。呼び出すと、設計者が
   * その領域に Puck で配置した部品が描画されます (#1411 P-3)。
   */
  content?: (props?: Record<string, unknown>) => React.ReactNode;
}

export default function ${pascal}({
  title = "サンプル外部部品",
  message = "",
  content,
}: ${pascal}Props) {
  return (
    <div
      data-external-component="${pascal}"
      style={{
        border: "1px solid #0d6efd",
        borderRadius: 6,
        padding: 12,
        background: "#f0f7ff",
      }}
    >
      <strong>{title}</strong>
      {message ? <p style={{ margin: "6px 0 0" }}>{message}</p> : null}
      {/* editable region: host 注入 slot。設計者が Puck で内部に部品を配置できる。 */}
      {content ? content() : null}
    </div>
  );
}
`;
}

function buildManifest(name, pascal) {
  return JSON.stringify(
    {
      schemaVersion: "1",
      components: [
        {
          id: name,
          label: pascal,
          module: `./dist/${name}.mjs`,
          export: "default",
          version: "0.1.0",
          engine: { react: "19", puck: "0.20" },
          props: [
            { name: "title", type: "string", label: "見出し", default: pascal },
            { name: "message", type: "string", label: "本文" },
          ],
          slots: [{ name: "content", label: "本文スロット" }],
        },
      ],
    },
    null,
    2,
  ) + "\n";
}

function buildReadme(name, pascal) {
  return `# ${pascal} — 外部 Puck Component (#1409 P-1)

Harmony の Puck デザイナーに runtime ESM import で読み込ませる外部業務 React Component です。

## 契約 (重要)

- **React / ReactDOM / @measured/puck は host (Harmony) と共有** します。bundle には含めません
  (\`vite.config.ts\` の \`rollupOptions.external\`)。host が index.html の import map +
  \`window.__HARMONY_SHARED_DEPS__\` bridge でこれらを供給するため、外部部品と host が
  同一インスタンスを共有し React 二重化 (Invalid hook call 等) を防ぎます。
- import は必ず bare specifier (\`import * as React from "react"\`) を使ってください。
  host 内部 path を直接 import しないこと。

## build と配置

\`\`\`bash
npm install
npm run build          # → dist/${name}.mjs を生成
\`\`\`

生成後、active workspace の \`<dataDir>/puck-components/\` に以下を配置します
(\`<dataDir>\` は workspace の \`harmony.json\` の \`dataDir\` 設定。例: \`workspaces/my-app/harmony/\`):

\`\`\`
<dataDir>/puck-components/
  manifest.json        ← 本リポジトリの manifest.json をコピー
  dist/${name}.mjs     ← build 成果物
\`\`\`

複数部品を 1 workspace に置く場合は \`manifest.json\` の \`components\` 配列に追記してマージします
(各 entry の \`module\` は \`puck-components/\` からの相対 path)。

## manifest.json

\`schemaVersion: "1"\`。各 component entry:

| field | 必須 | 説明 |
|---|---|---|
| \`id\` | ✅ | Puck config 上の key (workspace 内 unique) |
| \`label\` | ✅ | パレット表示名 |
| \`module\` | ✅ | \`puck-components/\` からの相対 \`.mjs\` path |
| \`export\` | | 読み込む export 名 (省略時 \`default\`) |
| \`version\` | ✅ | 部品バージョン |
| \`engine\` | | \`{ react, puck }\` の互換 major。host (react 19 / puck 0.20) と不一致なら読込エラー |
| \`props\` | | prop 宣言 (P-1 では default 集約のみ反映、fields 本格化は P-2) |
| \`slots\` | | named slot (editable region)。設計者が内部に部品を配置できる (P-3) |

## slot 契約 (editable region、#1411 P-3)

manifest の \`slots\` で named slot を宣言すると、host (Harmony) はその slot を Puck の
slot field として登録します。Puck は render 時に **対応する \`props.<slotName>\` を
render-prop (関数) に変換して注入** するため、component はその関数を呼んで描画するだけです。

- component は対応する \`props.<slotName>\` を **描画** する (例: \`content ? content() : null\`)。
- 設計者は Puck デザイナー上でその領域 (editable region) に他の部品を **ドラッグ配置** できる。
- 配置内容は当該 component の props に co-located で保存され、通常の保存/読込で素通りします。
- **\`@measured/puck\` の DropZone を自分で import する必要はありません** (host が注入)。

\`\`\`tsx
export interface SampleProps {
  content?: (props?: Record<string, unknown>) => React.ReactNode;
}
export default function Sample({ content }: SampleProps) {
  return <div>{content ? content() : null}</div>;
}
\`\`\`

slot 名は同 entry 内で unique かつ prop 名と衝突しないこと (manifest validator が検出します)。

## エラー時の挙動

manifest 不正 / engine 不一致 / 読込失敗 / export 不在 の場合、Puck canvas 上に赤系の
エラーカードが表示され、原因 (errorKind + 詳細) を確認できます。
`;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  }

  if (!args.name) {
    console.error(
      "使い方: node scripts/scaffold/puck-component.mjs <name> [--from-primitive <PrimitiveName>] [--out <dir>]",
    );
    process.exit(1);
  }

  const name = args.name;
  const pascal = toPascalCase(name);
  // 出力先は明示 --out があればそこ、なければ cwd 直下の ./<name>。
  // data/ への直書きは避ける (AGENTS.md)。
  const outBase = args.out ?? process.cwd();
  if (path.resolve(outBase).split(path.sep).includes("data")) {
    console.error(
      "エラー: data/ への scaffold は禁止です。--out で workspace 外の作業ディレクトリを指定してください。",
    );
    process.exit(1);
  }
  const targetDir = path.join(outBase, name);

  if (fs.existsSync(targetDir)) {
    console.error(`エラー: 出力先が既に存在します: ${targetDir}`);
    process.exit(1);
  }

  console.log(`外部 Puck Component を生成します: ${name} (${pascal})`);
  if (args.fromPrimitive) {
    console.log(`  primitive を出発点にコピー: ${args.fromPrimitive}`);
  }

  writeFile(targetDir, "package.json", buildPackageJson(name));
  writeFile(targetDir, "vite.config.ts", buildViteConfig(name, pascal));
  writeFile(targetDir, "tsconfig.json", buildTsConfig());
  writeFile(
    targetDir,
    `src/${pascal}.tsx`,
    args.fromPrimitive
      ? buildComponentFromPrimitive(pascal, args.fromPrimitive)
      : buildComponentSample(pascal),
  );
  writeFile(targetDir, "manifest.json", buildManifest(name, pascal));
  writeFile(targetDir, "README.md", buildReadme(name, pascal));

  console.log(`\n完了。次の手順:`);
  console.log(`  cd ${path.relative(process.cwd(), targetDir) || "."}`);
  console.log(`  npm install && npm run build`);
  console.log(`  → dist/${name}.mjs と manifest.json を workspace の <dataDir>/puck-components/ に配置`);
}

main();
