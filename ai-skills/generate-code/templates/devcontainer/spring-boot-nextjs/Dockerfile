FROM node:26-alpine AS frontend-builder
# npm を最新にそろえる (Harmony の package-lock.json と同じ系統。古い npm だと lock の libc の欄が消える)
# 層の cache が効くと、古い npm のまま残ることがある。作り直すときは docker build --pull --no-cache
RUN npm install -g npm@latest
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS backend-builder
WORKDIR /build
COPY pom.xml ./
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B clean package -DskipTests

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=backend-builder /build/target/*.jar app.jar
COPY --from=frontend-builder /build/frontend/.next /app/frontend/.next
COPY --from=frontend-builder /build/frontend/public /app/frontend/public
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]
