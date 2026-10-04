import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import bcrypt from "bcrypt";
import connectDB from "../../../lib/connectDB";
import User from "@/models/userModel";
import { passwordPolicyError } from "@/lib/passwordPolicy";
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
    // Shared with /api/auth/register so the two entry points cannot drift.
    const policyError = passwordPolicyError(password);
    if (policyError) return handleRes(res, 400, false, policyError);

    await connectDB();

    const hashedToken = crypto
      .createHash("sha256")
      .update(token.trim())
      .digest("hex");

    // Claim the token with a single conditional update rather than reading the
    // user and saving them back. The previous find-then-save made "single use"
    // true only by luck of timing: two parallel requests carrying the same valid
    // token both matched the read before either write landed, so both answered
    // "Password reset successfully" while the second silently overwrote the
    // password the first caller believed it had set. Matching the token in the
    // filter makes exactly one of them win; the loser resolves to null and is
    // told the token is invalid, which is what it is by then.
    const updated = await User.findOneAndUpdate(
      {
        resetPasswordToken: hashedToken,
        resetPasswordExpire: { $gt: new Date() },
      },
      {
        $set: {
          password: await bcrypt.hash(password, 10),
          passwordChangedAt: new Date(),
        },
        // A real $unset, so the token cannot be replayed afterwards.
        $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 },
      },
      { new: true }
    );

    if (!updated) {
      return handleRes(res, 400, false, "Reset token is invalid or has expired");
    }

    handleRes(res, 200, true, "Password reset successfully. You can now log in.");
  }
);

export default resetPassword;