# app-api. Build from the repository root (it bundles shared/ and ships the research fixtures):
#   docker build -f server/Dockerfile -t ppd-app-api .
FROM node:24.11-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci
COPY shared shared
COPY server server
RUN npm --prefix server run build

FROM node:24.11-alpine
WORKDIR /app
ENV NODE_ENV=production APP_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_PATH=/data/app.db
COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci --omit=dev && mkdir -p /data && chown node:node /data
COPY --from=build /app/server/dist server/dist
COPY server/config server/config
COPY public/mock public/mock
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/index.js"]
