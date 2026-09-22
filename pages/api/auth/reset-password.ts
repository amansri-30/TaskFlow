import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import bcrypt from "bcrypt";
import connectDB from "../../../lib/connectDB";
import User from "@/models/userModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

const resetPassword = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
      return handleRes(res, 405, false, "Only POST requests are allowed");

    const { token, password } = req.body;
    if (!token || typeof token !== "string" || !password) {
      return handleRes(res, 400, false, "Reset token and new password are required");
    }
    if (typeof password !== "string" || password.length < 10) {
      return handleRes(res, 400, false, "Password must be at least 10 characters");
    }

    await connectDB();

    const hashedToken = crypto
      .createHash("sha256")
      .update(token.trim())
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: new Date() },
    }).select("+password +resetPasswordToken");

    if (!user) {
      return handleRes(res, 400, false, "Reset token is invalid or has expired");
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    handleRes(res, 200, true, "Password reset successfully. You can now log in.");
  }
);

export default resetPassword;