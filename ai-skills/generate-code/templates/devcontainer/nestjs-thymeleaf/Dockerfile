FROM node:26-alpine AS builder
# npm を最新にそろえる (Harmony の package-lock.json と同じ系統。古い npm だと lock の libc の欄が消える)
# 層の cache が効くと、古い npm のまま残ることがある。作り直すときは docker build --pull --no-cache
RUN npm install -g npm@latest
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
# @orm prisma
RUN mkdir -p views prisma
# @end-orm
# @orm typeorm
RUN mkdir -p views data
# @end-orm
# @orm prisma
RUN npx prisma generate 2>/dev/null || true
# @end-orm
RUN npm run build

FROM node:26-alpine
WORKDIR /app
COPY --from=builder /build/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/views ./views
# @orm prisma
COPY --from=builder /build/prisma ./prisma
# 本番の node_modules には Prisma Client が無いので、ここで作る (prisma は dependencies に入れておく)
RUN npx prisma generate
RUN mkdir -p data
# @end-orm
# @orm typeorm
RUN mkdir -p data
# @end-orm
EXPOSE 3000
CMD ["node", "dist/src/main"]
