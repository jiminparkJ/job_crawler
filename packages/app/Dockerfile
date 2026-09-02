FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/app/package.json packages/app/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages/core packages/core
COPY packages/app packages/app
RUN pnpm --filter @job-hunter/app build
# Generate Prisma client into node_modules
RUN pnpm --filter @job-hunter/app db:generate

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/packages/app/dist ./packages/app/dist
COPY --from=build /app/packages/app/prisma ./packages/app/prisma
COPY --from=build /app/packages/app/package.json ./packages/app/
COPY package.json pnpm-workspace.yaml ./
WORKDIR /app/packages/app
EXPOSE 3000
CMD ["node", "dist/main.js"]
