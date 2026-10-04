import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import Subscriber from "@/models/subscriberModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const subscribeHandler = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
      return handleRes(res, 405, false, "Only POST requests are allowed");

    const { email } = req.body;
    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return handleRes(res, 400, false, "Please enter a valid email address");
    }

    await connectDB();

    const normalized = email.trim().toLowerCase();
    // Checked only to produce a friendly message. It is not the enforcement
    // mechanism -- `findOne`-then-`create` is a TOCTOU, and when several
    // identical requests arrive together they all pass the check and the
    // duplicates surface as a raw "That value is already in use." from
    // catchAsyncError, which reads like a server fault. The unique index on the
    // collection is what actually prevents the duplicate; a 11000 here is the
    // expected outcome of that race, not an error to report verbatim.
    const existing = await Subscriber.findOne({ email: normalized });
    if (existing) {
      return handleRes(res, 409, false, "You are already subscribed");
    }

    try {
      await Subscriber.create({ email: normalized });
    } catch (err: any) {
      if (err?.code === 11000) {
        return handleRes(res, 409, false, "You are already subscribed");
      }
      throw err;
    }

    handleRes(res, 200, true, "Subscription successful");
  }
);

export default subscribeHandler;