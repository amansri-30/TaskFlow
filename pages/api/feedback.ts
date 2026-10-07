import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import Feedback from "@/models/feedbackModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

const feedbackHandler = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
      return handleRes(res, 405, false, "Only POST requests are allowed");

    const { email, message } = req.body;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      return handleRes(res, 400, false, "A valid email is required");
    }
    if (email.trim().length > 254) {
      return handleRes(res, 400, false, "That email address is too long");
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return handleRes(res, 400, false, "Feedback message is required");
    }
    // This route takes no authentication, so the only thing standing between it
    // and an unbounded write is validation. Without a cap, a single request can
    // store a string the size of the request body limit, and nothing downstream
    // -- not the model, not the reader, which only ever shows a snippet -- needs
    // anything close to that.
    if (message.length > 2000) {
      return handleRes(res, 400, false, "Feedback message is too long (max 2000 characters)");
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