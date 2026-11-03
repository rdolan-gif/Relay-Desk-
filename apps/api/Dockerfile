# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @relay-desk/api...
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN pnpm --filter @relay-desk/domain build && pnpm --filter @relay-desk/api build \
  && pnpm --filter @relay-desk/api deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
