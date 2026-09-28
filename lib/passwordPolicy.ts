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
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes (some characters count as more than one)`;
  }
  return null;
};
