// Identity fields that are safe to serialize to the browser. Everything else on
// the user document is either a secret (password hash, reset token) or internal
// bookkeeping (lockout state, password-change stamp), and must not ride along in
// auth responses just because it happened to be selected.
export function toPublicUser(user: any) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
