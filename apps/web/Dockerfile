# Single-stage build, mirroring apps/api/Dockerfile's prod target: the whole monorepo is
# needed at build time since @navar/domain / @navar/api are consumed as workspace TS source
# (transpilePackages in next.config.mjs), not published packages.
FROM node:22-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time, so it has to be a
# build ARG, not just a runtime env var on the running container.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NODE_ENV=production

RUN pnpm --filter @navar/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@navar/web", "start"]
