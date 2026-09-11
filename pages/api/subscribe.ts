import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import Subscriber from "@/models/subscriberModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const subscribeHandler = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
      return handleRes(res, 400, false, "Only POST requests are allowed");

    const { email } = req.body;
    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return handleRes(res, 400, false, "Please enter a valid email address");
    }

    await connectDB();

    const existing = await Subscriber.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return handleRes(res, 409, false, "You are already subscribed");
    }

    await Subscriber.create({ email: email.trim().toLowerCase() });

    handleRes(res, 200, true, "Subscription successful");
  }
);

export default subscribeHandler;