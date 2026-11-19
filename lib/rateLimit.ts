import type { NextApiRequest } from "next";

// Fixed-window limiter for the unauthenticated write endpoints
// (/api/feedback, /api/subscribe, /api/auth/*). It is deliberately in-memory and per-process:
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

/**
 * Best-effort caller identity for the limiter.
 *
 * `x-forwarded-for` is client-supplied unless a proxy overwrites it, so trusting
 * its first hop let one caller mint unlimited buckets by changing the header on
 * every request. Trust proxy headers only where the platform is known to set
 * them (Vercel) or the deployment explicitly opts in with
 * `TASKFLOW_TRUST_PROXY_HEADERS=1`; otherwise key by the socket peer, which is
 * never user-controlled even when it means a coarser shared budget.
 */
const TRUST_PROXY_HEADERS =
  process.env.TASKFLOW_TRUST_PROXY_HEADERS === "1" ||
  process.env.VERCEL === "1";

export function clientKey(req: NextApiRequest): string {
  const header = (name: string): string => {
    const value = req.headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    return (first || "").split(",")[0].trim();
  };

  if (TRUST_PROXY_HEADERS) {
    // These are set by Vercel/Cloudflare rather than appended to by them.
    const realIp = header("x-real-ip") || header("cf-connecting-ip");
    if (realIp) return realIp;

    // `x-forwarded-for` is a chain and its first hop is only trustworthy when
    // an operator has confirmed their proxy rewrites it.
    if (process.env.TASKFLOW_TRUST_PROXY_HEADERS === "1") {
      const forwarded = header("x-forwarded-for");
      if (forwarded) return forwarded;
    }
  }

  return req.socket?.remoteAddress || "unknown";
}
