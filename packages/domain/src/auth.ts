import { z } from "zod";

/**
 * Auth surface (SRS §6.1 `FR-AUTH-001..003`, TDD §7). The Guest authenticates only through
 * the Silpo MCP OAuth flow; the client holds a system session cookie, never the Silpo token
 * (`FR-AUTH-002`).
 */

export const authStatusSchema = z.object({
  connected: z.boolean(),
  householdId: z.string().uuid().optional(),
});
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const startLoginResultSchema = z.object({
  /** The `auth.silpo.ua` authorization URL to send the browser to. */
  url: z.string().url(),
});
export type StartLoginResult = z.infer<typeof startLoginResultSchema>;

export const logoutResultSchema = z.object({ ok: z.boolean() });
export type LogoutResult = z.infer<typeof logoutResultSchema>;
