# Harmony L2 production Dockerfile (#1472)
#
# 1 container で SPA / HTTP MCP / WebSocket を port 5179 から提供する。
# - frontend/dist は backend の HTTP fallback で静的配信する
# - HARMONY_HOME は machine-local state (recent-workspaces.json 等)
# - /data/workspaces はユーザー workspace の推奨 mount point

# ─── stage 1: build ─────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_HARMONY_SAME_PORT=1
ENV VITE_HARMONY_SAME_PORT=${VITE_HARMONY_SAME_PORT}

COPY package.json package-lock.json ./
# shared の prepare (tsc) が npm ci の中で走るので、npm ci より前に shared をソースごとコピーする。
# そのため shared のソースを変えると、npm ci の層が作り直しになる (ビルドが遅くなるが、挙動は正しい)
COPY shared ./shared
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
RUN npm ci

# frontend / backend はリポジトリ直下の schemas を import するので build にも必要
COPY schemas ./schemas
COPY frontend ./frontend
COPY backend ./backend
RUN npm run build --workspace=@harmony/shared \
    && npm run build --workspace=frontend \
    && npm run build --workspace=backend \
    && npm prune --omit=dev

# ─── stage 2: runtime ───────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HARMONY_HOME=/home/node/.harmony
ENV HARMONY_STATIC_DIR=/app/frontend/dist
ENV DESIGNER_LOG_DIR=/app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY data/extensions ./data/extensions
# AI (MCP) が Resources / Prompts で読む資料 (docs/spec・docs/AI-INDEX.md・schemas・ai-skills)。.dockerignore の docs 除外から、これらだけ戻している
COPY schemas ./schemas
COPY docs/spec ./docs/spec
COPY docs/AI-INDEX.md docs/codemap.md docs/glossary.json ./docs/
COPY docs/decisions ./docs/decisions
COPY examples/PATTERNS.md ./examples/PATTERNS.md
COPY ai-skills ./ai-skills

# Docker は named volume 初期化時に image 内ディレクトリの owner/mode を引き継ぐ。
# VOLUME 宣言前に node 所有へ揃え、runtime 書き込みを EACCES にしない。
RUN mkdir -p /home/node/.harmony /data/workspaces logs \
    && chown -R node:node /home/node/.harmony /data/workspaces logs

VOLUME ["/home/node/.harmony", "/data/workspaces"]

EXPOSE 5179

USER node
CMD ["node", "backend/dist/index.js"]
