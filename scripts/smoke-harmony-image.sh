#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-local}"
IMAGE="${HARMONY_IMAGE:-ghcr.io/csilost2001/harmony:${VERSION}}"
PORT="${HARMONY_SMOKE_PORT:-5179}"
CONTAINER_NAME="harmony-smoke-${PORT}"
ENGINE="${CONTAINER_ENGINE:-docker}"

if ! command -v "${ENGINE}" >/dev/null 2>&1; then
  echo "${ENGINE} command not found. Set CONTAINER_ENGINE=docker or CONTAINER_ENGINE=podman and run this on the host." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node command not found. Run this script from the Harmony host checkout after npm install." >&2
  exit 1
fi

cleanup() {
  "${ENGINE}" rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
"${ENGINE}" run -d \
  --name "${CONTAINER_NAME}" \
  -p "127.0.0.1:${PORT}:5179" \
  -e HARMONY_TRUST_LOCALHOST_PUBLISHED_PORT=1 \
  -v "harmony-smoke-state:/home/node/.harmony" \
  -v "harmony-smoke-workspaces:/data/workspaces" \
  "${IMAGE}" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/" | grep -qi '<!doctype html'
curl -fsS \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"harmony-smoke","version":"1"}}}' \
  "http://127.0.0.1:${PORT}/mcp" | grep -q 'harmony-mcp'

HARMONY_SMOKE_PORT="${PORT}" node -e '
const WebSocket = require("ws");
const port = process.env.HARMONY_SMOKE_PORT;
const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
  headers: {
    Origin: `http://127.0.0.1:${port}`,
    Host: `127.0.0.1:${port}`,
  },
});
const timer = setTimeout(() => {
  console.error("WebSocket smoke timeout");
  process.exit(1);
}, 3000);
ws.once("open", () => {
  clearTimeout(timer);
  ws.close();
});
ws.once("error", (err) => {
  clearTimeout(timer);
  console.error(err.message);
  process.exit(1);
});
'

# 配布 image の中身の確認 (#1577)。
# (1) /app/build-info.json の commit が、image の label (org.opencontainers.image.revision) と一致し、MCP の designer__workspace_status の harmony.commit と一致すること。
#     HARMONY_SMOKE_EXPECT_COMMIT (build のときの完全な commit) を渡したときだけ、それとも一致すること。渡さなければ host の checkout の HEAD とは照合しない
#     (build のあとに host で commit した・pull した、別の image を確かめることがあるため。違うときは注意を出すだけ)
#     (commit を記録していない image = git の作業コピーでなく作った image は、この確認を飛ばす)
# (2) 開発コンテナの雛形 (generate-code の 4 組合せ × 7 ファイル) が /app/ai-skills の中にあること (designer__get_scaffold_update が読む)
BUILD_INFO="$("${ENGINE}" exec "${CONTAINER_NAME}" cat /app/build-info.json)" || {
  echo "image に /app/build-info.json がありません (Dockerfile の build-info の書き込みを確認してください)" >&2
  exit 1
}
IMAGE_COMMIT="$(printf '%s' "${BUILD_INFO}" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).commit||""))}catch{}})')"
if [ -n "${IMAGE_COMMIT}" ]; then
  LABEL_COMMIT="$("${ENGINE}" inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${CONTAINER_NAME}")"
  if [ "${LABEL_COMMIT}" != "${IMAGE_COMMIT}" ]; then
    echo "image の label の revision (${LABEL_COMMIT}) が build-info.json の commit (${IMAGE_COMMIT}) と違います" >&2
    exit 1
  fi
  if [ -n "${HARMONY_SMOKE_EXPECT_COMMIT:-}" ]; then
    if [ "${HARMONY_SMOKE_EXPECT_COMMIT}" != "${IMAGE_COMMIT}" ]; then
      echo "build-info.json の commit (${IMAGE_COMMIT}) が、HARMONY_SMOKE_EXPECT_COMMIT (${HARMONY_SMOKE_EXPECT_COMMIT}) と違います" >&2
      exit 1
    fi
  else
    HOST_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
    if [ -n "${HOST_HEAD}" ] && [ "${HOST_HEAD}" != "${IMAGE_COMMIT}" ]; then
      echo "注意: image の commit (${IMAGE_COMMIT:0:7}) が、host の checkout の HEAD (${HOST_HEAD:0:7}) と違います。build のあとに commit した・別の image を確かめている場合は問題ありません。照合するなら HARMONY_SMOKE_EXPECT_COMMIT を指定してください" >&2
    fi
  fi
  HARMONY_SMOKE_PORT="${PORT}" HARMONY_SMOKE_COMMIT="${IMAGE_COMMIT}" node -e '
const port = process.env.HARMONY_SMOKE_PORT;
const want = process.env.HARMONY_SMOKE_COMMIT.slice(0, 7);
fetch(`http://127.0.0.1:${port}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "designer__workspace_status", arguments: {} } }),
}).then(async (res) => {
  const text = await res.text();
  // JSON の返答か、SSE (data: 行) のどちらでも読む
  const data = text.trim().startsWith("{") ? text : text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  const status = JSON.parse(JSON.parse(data).result.content[0].text);
  if (!status.harmony || status.harmony.commit !== want || status.harmony.source !== "image") {
    console.error(`workspace_status の harmony が build の commit (${want}・source image) と一致しません: ${JSON.stringify(status.harmony)}`);
    process.exit(1);
  }
}).catch((err) => { console.error(`workspace_status の確認に失敗しました: ${err.message}`); process.exit(1); });
'
else
  echo "注意: build-info.json に commit がない image です (git の作業コピーでなく作った)。commit の一致の確認を飛ばします" >&2
fi

TEMPLATES="/app/ai-skills/generate-code/templates/devcontainer"
for combo in spring-boot-thymeleaf spring-boot-nextjs nestjs-thymeleaf nestjs-nextjs; do
  for f in .devcontainer/compose.yml .devcontainer/devcontainer.json .mcp.json .tmp/.gitignore Dockerfile README.snippet.md docker-compose.yml; do
    if ! "${ENGINE}" exec "${CONTAINER_NAME}" test -f "${TEMPLATES}/${combo}/${f}"; then
      echo "image に開発コンテナの雛形がありません: ${TEMPLATES}/${combo}/${f} (.dockerignore や COPY ai-skills を確認してください)" >&2
      exit 1
    fi
  done
done

echo "Smoke passed for ${IMAGE} on port ${PORT}"
