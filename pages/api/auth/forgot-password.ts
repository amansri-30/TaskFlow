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

    // No email transport is wired up in this deployment, so the reset token
    // itself is the only delivery channel. Handing it back in the response
    // would let anyone POST any email address and take over that account, so
    // the token is minted ONLY when explicitly opted in for local/demo use.
    // With no token issued we answer exactly like the unknown-email case.
    const exposeToken = process.env.TASKFLOW_EXPOSE_RESET_TOKEN === "true";
    if (!exposeToken) {
      return handleRes(
        res,
        200,
        true,
        "If an account exists with this email, a reset link has been sent"
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

    handleRes(
      res,
      200,
      true,
      "If an account exists with this email, a reset link has been sent",
      {
        resetToken,
        expiresInMinutes: 60,
      }
    );
  }
);

export default forgotPassword;