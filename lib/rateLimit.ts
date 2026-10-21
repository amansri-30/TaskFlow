import type { NextApiRequest } from "next";

// Fixed-window limiter for the two unauthenticated write endpoints
// (/api/feedback, /api/subscribe). It is deliberately in-memory and per-process:
// no new dependency, and the worst case on a multi-instance deploy is that the
// budget is multiplied by the number of instances — still a bound, which is what
// these routes lacked (a single client could otherwise write unbounded rows with
// nothing but validation in front of it).
//
// The map is capped so a scan of one-shot keys cannot grow it without limit;
// expired windows are reclaimed first, then the oldest insert is evicted.
const MAX_BUCKETS = 5000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Returns true when the call is within the budget, false when it must be rejected. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      buckets.forEach((b, k) => {
        if (b.resetAt <= now) buckets.delete(k);
      });
      while (buckets.size >= MAX_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/** Best-effort caller identity: the first forwarded hop, else the socket peer. */
export function clientKey(req: NextApiRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = first?.split(",")[0]?.trim();
  return ip || req.socket?.remoteAddress || "unknown";
}
