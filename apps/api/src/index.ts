import { closeDb, db } from "@navar/db";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import cors from "@fastify/cors";
import { sql } from "drizzle-orm";
import Fastify from "fastify";

import { env } from "./env.js";
import { initRetail } from "./retail.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/health", async () => {
  await db.execute(sql`select 1`);
  return { status: "ok", db: "ok" };
});

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

// tools/list at startup (INT-MCP-001). Non-blocking: missing credentials must not stop the API.
void initRetail();

const close = async () => {
  await app.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ host: "0.0.0.0", port: env.API_PORT });
