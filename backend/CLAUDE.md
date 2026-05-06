# CLAUDE.md — Backend

Claude Code 向け補足。プロジェクト全般のルールは [../AGENTS.md](../AGENTS.md)、backend 固有ルールは [AGENTS.md](./AGENTS.md) を参照。

@AGENTS.md

---

## Claude Code 固有の補足

### MCP 接続

- `.mcp.json` の URL エントリ (`http://localhost:5179/mcp`) で本サーバに接続
- 起動前提: このディレクトリで `npm run dev` により常駐済みであること
