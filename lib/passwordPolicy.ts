/**
 * Single source of truth for the plaintext password policy.
 *
 * Two rules that are easy to get wrong on their own:
 *
 * 1. Length must be checked on the PLAINTEXT, before hashing. The User schema
 *    has `minlength: 10`, but Mongoose validates the document, which by then
 *    holds the 60-character bcrypt digest — so the schema check can never
 *    reject a short password and only the handler catches it.
 * 2. bcrypt truncates at 72 BYTES of input, not 72 characters. `"A".repeat(40)`
 *    is 40 characters and 40 bytes, but "🔒".repeat(30) is 30 characters and
 *    120 bytes. Anything past 72 bytes is silently discarded, so a long
 *    password would appear to be set while only its prefix is actually
 *    enforced. Measuring with `.length` lets those through.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_BYTES = 72;

/**
 * @returns an error message when the password is unacceptable, otherwise null.
 */
export const passwordPolicyError = (password: unknown): string | null => {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required";
  }
  // `.length` counts UTF-16 units, so five emoji passed this ten-character rule.
  // Count code points to match the policy's own definition of a character; the
  // byte ceiling below still bounds the bcrypt input independently.
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  // TextEncoder gives the same UTF-8 byte count as Buffer.byteLength and also
  // exists in the browser, so the signup/reset forms can call this same policy
  // before submitting instead of waiting for the server to reject an emoji-heavy
  // password that is short in characters but long in bytes.
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes (some characters count as more than one)`;
  }
  return null;
};
