import type { NextApiRequest, NextApiResponse } from "next";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

const getQuote = catchAsyncError(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") return handleRes(res, 400, false, "Only GET requests are allowed");

  const apiKey = process.env.QUOTES_API_KEY;
  if (!apiKey) return handleRes(res, 500, false, "Quotes API key not configured");

  const response = await fetch(
    "https://api.api-ninjas.com/v1/quotes?category=inspirational",
    { headers: { "X-Api-Key": apiKey } }
  );

  if (!response.ok) return handleRes(res, 502, false, "Quotes API request failed");

  const data = await response.json();
  return handleRes(res, 200, true, "Quote fetched", { quote: data[0]?.quote || "" });
});

export default getQuote;
