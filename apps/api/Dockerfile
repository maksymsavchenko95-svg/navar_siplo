FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- dev: source is bind-mounted by docker-compose, deps install on first boot ----
FROM base AS dev
COPY apps/api/docker-entrypoint.sh /usr/local/bin/navar-entrypoint
RUN chmod +x /usr/local/bin/navar-entrypoint
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/navar-entrypoint"]

# ---- prod: self-contained image, used by docker-compose.prod.yml ----
FROM base AS prod
ENV NODE_ENV=production
COPY . .
RUN pnpm install --frozen-lockfile
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @navar/db db:migrate && pnpm --filter @navar/api start"]
