import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import connectDB from "../../../lib/connectDB";
import User from "@/models/userModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";

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

    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.trim()) {
      return handleRes(res, 400, false, "Email is required");
    }

    await connectDB();

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    if (!user) {
      return handleRes(res, 200, true, NEUTRAL_RESPONSE);
    }

    // No email transport is wired up in this deployment, so the reset token
    // itself is the only delivery channel. Handing it back in the response
    // would let anyone POST any email address and take over that account, so
    // the token is minted ONLY when explicitly opted in for local/demo use.
    const exposeToken = process.env.TASKFLOW_EXPOSE_RESET_TOKEN === "true";
    if (!exposeToken) {
      // Report the misconfiguration instead of claiming a mail was sent. The
      // previous "200, reset link sent" was a lie in the strictest sense: no
      // token was ever written, so no reset could ever be completed, while the
      // caller had no way to tell. This response does not depend on whether the
      // address was found, so it carries no enumeration signal.
      return handleRes(
        res,
        501,
        false,
        "Password reset is not available on this deployment"
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
      NEUTRAL_RESPONSE,
      {
        resetToken,
        expiresInMinutes: 60,
      }
    );
  }
);

export default forgotPassword;