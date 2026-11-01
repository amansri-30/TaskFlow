import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import connectDB from "../../../lib/connectDB";
import User from "@/models/userModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import { rateLimit, clientKey } from "@/lib/rateLimit";

// One string, used at every return site that must look identical. The three
// paths below used to vary the final word -- "issued" for an unknown address,
// "sent" otherwise -- which handed back the exact oracle the comments claimed to
// remove: identical status and success flag, but a one-word diff that any script
// could read to learn which emails have accounts, then feed to the login
// endpoint. Deriving the wording from a single constant makes that class of
// regression impossible to reintroduce by editing one branch.
const NEUTRAL_RESPONSE =
  "If an account exists with this email, a reset link has been sent";

const forgotPassword = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST")
      return handleRes(res, 405, false, "Only POST requests are allowed");

    // Every call costs a DB read, and in token-exposing demo mode a write that
    // mints a live reset token. The neutral response intentionally cannot
    // distinguish addresses, so without this an attacker could spray the whole
    // user table from one host.
    if (!rateLimit(`forgot:${clientKey(req)}`, 5, 10 * 60_000)) {
      return handleRes(res, 429, false, "Too many requests. Please try again later");
    }

    const { email } = req.body || {};
    if (!email || typeof email !== "string" || !email.trim()) {
      return handleRes(res, 400, false, "Email is required");
    }

    // No email transport is wired up in this deployment, so the reset token
    // itself is the only delivery channel. Handing it back in the response
    // would let anyone POST any email address and take over that account, so
    // the token is minted ONLY when explicitly opted in for local/demo use.
    //
    // This capability check runs BEFORE the database lookup. Answering 501 for
    // a registered address and 200 for an unknown one was an account-existence
    // oracle -- the exact leak the neutral message below exists to close -- so
    // an unavailable deployment now answers every caller identically, without
    // touching the user table at all.
    const exposeToken = process.env.TASKFLOW_EXPOSE_RESET_TOKEN === "true";
    if (!exposeToken) {
      return handleRes(
        res,
        501,
        false,
        "Password reset is not available on this deployment"
      );
    }

    await connectDB();

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    if (!user) {
      return handleRes(res, 200, true, NEUTRAL_RESPONSE);
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
      NEUTRAL_RESPONSE,
      {
        resetToken,
        expiresInMinutes: 60,
      }
    );
  }
);

export default forgotPassword;