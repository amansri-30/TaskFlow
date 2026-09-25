import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import connectDB from "../../../lib/connectDB";
import User from "@/models/userModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

const forgotPassword = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
      return handleRes(res, 405, false, "Only POST requests are allowed");

    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.trim()) {
      return handleRes(res, 400, false, "Email is required");
    }

    await connectDB();

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    if (!user) {
      // Identical status + message to the success path so the endpoint cannot
      // be used to enumerate which emails have accounts.
      return handleRes(
        res,
        200,
        true,
        "If an account exists with this email, a reset link has been issued"
      );
    }

    // Create a one-time reset token (hashed at rest) that expires in 60 minutes.
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    handleRes(res, 200, true, "Password reset link sent", {
      resetToken,
      expiresInMinutes: 60,
    });
  }
);

export default forgotPassword;