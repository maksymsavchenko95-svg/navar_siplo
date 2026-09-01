/**
 * Data minimisation — strip personal data before it leaves our boundary, in particular
 * before anything is sent to the LLM (`INT-LLM-004`, `.claude/rules/mcp-integration.md`).
 * Deterministic, pure, dependency-free. Also used by the MCP audit scripts to keep
 * redacted response fixtures out of git.
 *
 * The missing-`name` leak (a family member's `name` on a person record) is the canonical
 * regression here — see `pii.test.ts` and `.claude/rules/testing.md`.
 */

/** Object keys whose string/number values are personal data and must never be sent on. */
export const PII_KEYS =
  /^(phone|phoneNumber|email|firstName|lastName|middleName|fullName|patronymic|birthday|birthDate|dateOfBirth|latitude|longitude|lat|lng|lon|cardNumber|loyaltyCardNumber|barcode|addressLine|street|houseNumber|building|flat|apartment|floor|entrance|comment|recipientName|contactName|receiptUrl|receipt_url)$/i;

const REDACTED = "«redacted»";

/**
 * Recursively replace personal-data leaf values with a placeholder, preserving structure.
 * Also redacts a bare `name` when the containing object looks like a person record
 * (profile / family member / child / recipient) — product/category `name`s are left intact.
 * `dateOfBirth` marks a child record (Silpo family `children[]` carry no `profileId`/`itsMe`).
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const isPerson =
      "itsMe" in obj || "profileId" in obj || "profileCreatedAt" in obj || "dateOfBirth" in obj;
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        const isPii = PII_KEYS.test(k) || (isPerson && /^name$/i.test(k));
        return [
          k,
          isPii && (typeof v === "string" || typeof v === "number") ? REDACTED : redact(v),
        ];
      }),
    );
  }
  return value;
}
