# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @relay-desk/web...
COPY packages/domain packages/domain
COPY apps/web apps/web
RUN pnpm --filter @relay-desk/domain build && pnpm --filter @relay-desk/web build

FROM nginx:1.27-alpine
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
