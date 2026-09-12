import { closeDb, db } from "@navar/db";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { sql } from "drizzle-orm";
import Fastify from "fastify";

import { completeLogin } from "./auth-flow.js";
import { env } from "./env.js";
import { closeBootstrapQueue } from "./queue/bootstrap-queue.js";
import { connection } from "./queue/connection.js";
import { startBootstrapWorker } from "./queue/worker.js";
import { checkLlmHealth, getLlmHealth } from "./llm.js";
import { initRetail } from "./retail.js";
import { sessions } from "./session.js";
import { createContext } from "./trpc/context.js";
import { SESSION_COOKIE } from "./trpc/context.js";
import { PENDING_COOKIE, takePending } from "./trpc/routers/auth.js";
import { appRouter } from "./trpc/router.js";

// Behind Caddy in production, trustProxy makes `req.protocol` report `https` (from
// X-Forwarded-Proto) so the `secure` cookie flag below actually gets set. No-op in dev.
const app = Fastify({ logger: true, trustProxy: env.NODE_ENV === "production" });

await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
await app.register(cookie, { secret: env.COOKIE_SECRET });

app.get("/health", async () => {
  await db.execute(sql`select 1`);
  const llm = getLlmHealth();
  return {
    status: "ok",
    db: "ok",
    llm: llm.status,
    llmModel: llm.model,
    llmRerankModel: llm.rerankModel,
  };
});

/**
 * Silpo OAuth redirect target (`FR-AUTH-001`). Exchanges the code, settles the account,
 * mints a session, and bounces back to the web app. Errors redirect with `?auth=error`.
 */
app.get<{ Querystring: { code?: string; error?: string } }>(
  "/auth/silpo/callback",
  async (req, reply) => {
    const back = (q: string) => reply.redirect(`${env.WEB_ORIGIN}/${q}`);
    try {
      const { code, error } = req.query;
      if (error || !code) return back(`?auth=${error ?? "no_code"}`);

      const pendingId = await takePending(req.cookies[PENDING_COOKIE]);
      reply.clearCookie(PENDING_COOKIE, { path: "/" });
      if (!pendingId) return back("?auth=expired");

      const { householdId } = await completeLogin(pendingId, code);
      const sid = await sessions.create(householdId);
      // Deploy note: `sameSite: "lax"` works while web + API share a registrable domain
      // (incl. localhost). Split across unrelated domains → needs `sameSite: "none"` + `secure`.
      reply.setCookie(SESSION_COOKIE, sid, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.protocol === "https",
        path: "/",
        maxAge: env.SESSION_TTL_S,
      });
      return back("");
    } catch (err) {
      req.log.error(err, "oauth callback failed");
      return back("?auth=error");
    }
  },
);

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

void initRetail();
void checkLlmHealth();

const bootstrapWorker = startBootstrapWorker();

const close = async () => {
  await app.close();
  await bootstrapWorker.close();
  await closeBootstrapQueue();
  connection.disconnect();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ host: "0.0.0.0", port: env.API_PORT });
