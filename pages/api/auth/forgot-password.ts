import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../../lib/connectDB";
import User from "@/models/userModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

const forgotPassword = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
      return handleRes(res, 400, false, "Only POST requests are allowed");

    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.trim()) {
      return handleRes(res, 400, false, "Email is required");
    }

    await connectDB();

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("_id");

    if (!user) {
      return handleRes(res, 404, false, "No account found with this email");
    }

    handleRes(res, 200, true, "Password reset link sent", { exists: true });
  }
);

export default forgotPassword;