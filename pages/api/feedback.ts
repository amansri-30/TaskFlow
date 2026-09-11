import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import Feedback from "@/models/feedbackModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

const feedbackHandler = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
      return handleRes(res, 400, false, "Only POST requests are allowed");

    const { email, message } = req.body;
    if (!email || typeof email !== "string") {
      return handleRes(res, 400, false, "Email is required");
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return handleRes(res, 400, false, "Feedback message is required");
    }

    await connectDB();

    await Feedback.create({
      email: email.trim(),
      message: message.trim(),
    });

    handleRes(res, 200, true, "Feedback submitted successfully");
  }
);

export default feedbackHandler;