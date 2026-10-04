import type { NextApiRequest, NextApiResponse } from "next";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

// A quote is decorative: the sidebar renders it above the task list and the app
// works identically without it. So it is served from a short in-process cache
// rather than forwarded upstream on every call. Without this the endpoint was an
// anonymous, uncached, billable proxy -- every dashboard mount, every tab and
// every focus event spent a call from the shared API key's quota.
const CACHE_TTL_MS = 60 * 60 * 1000;
let cached: { quote: string; expiresAt: number } | null = null;

const getQuote = catchAsyncError(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") return handleRes(res, 405, false, "Only GET requests are allowed");

  if (cached && cached.expiresAt > Date.now()) {
    // Also told to the shared caches, so repeat hits across instances are free
    // even when each one misses its own memory.
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate");
    return handleRes(res, 200, true, "Quote fetched", { quote: cached.quote });
  }

  const apiKey = process.env.QUOTES_API_KEY;
  if (!apiKey) return handleRes(res, 500, false, "Quotes API key not configured");

  // A stalled upstream used to hold the socket for undici's default timeout of
  // several minutes, so one blackholed request could pin an instance. Three
  // seconds is generous for a decorative string.
  let response: Response;
  try {
    response = await fetch(
      "https://api.api-ninjas.com/v1/quotes?category=inspirational",
      {
        headers: { "X-Api-Key": apiKey },
        signal: AbortSignal.timeout(3000),
      }
    );
  } catch {
    // A timeout or DNS failure is not a 500 in the caller's terms; the sidebar
    // renders without a quote.
    return handleRes(res, 502, false, "Quotes API request failed");
  }

  if (!response.ok) return handleRes(res, 502, false, "Quotes API request failed");

  const data = await response.json();
  const quote = data[0]?.quote || "";
  // Only cache a real quote. Storing the empty string would suppress the
  // upstream for an hour after a single malformed response.
  if (quote) cached = { quote, expiresAt: Date.now() + CACHE_TTL_MS };
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate");
  return handleRes(res, 200, true, "Quote fetched", { quote });
});

export default getQuote;
