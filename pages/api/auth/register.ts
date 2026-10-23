import connectDB from "@/lib/connectDB";
import generateJWTToken from "@/lib/generateJwtToken";
import { saveCookie } from "@/lib/saveCookies";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import { handleRes } from "@/middleware/resHandler";
import User from "@/models/userModel";
import { passwordPolicyError } from "@/lib/passwordPolicy";
import { toPublicUser } from "@/lib/publicUser";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcrypt";

const registerUser = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return handleRes(res, 405, false, "Only POST request is allowed");

    // Registration answers "Email already registered" (standard UX), which is
    // also an existence oracle; capping attempts per source keeps it from being
    // turned into a bulk email-harvesting tool.
    if (!rateLimit(`register:${clientKey(req)}`, 10, 15 * 60_000)) {
      return handleRes(res, 429, false, "Too many attempts. Please try again later");
    }

    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return handleRes(res, 400, false, "All fields required!");
    // Validate the plaintext password BEFORE hashing. The schema's minLength
    // runs against the 60-character bcrypt digest, so it can never reject a
    // short password — only this check actually enforces the policy.
    const policyError = passwordPolicyError(password);
    if (policyError) return handleRes(res, 400, false, policyError);
    // Store the email normalized (trim + lowercase) so lookup is case-insensitive
    // everywhere — otherwise a mixed-case signup could be locked out.
    const normalizedEmail = String(email).trim().toLowerCase();

    await connectDB();
    let user = await User.findOne({ email: normalizedEmail });
    if (user) return handleRes(res, 400, false, "Email already registered. Try logging in.");

    const hashedPassword = await bcrypt.hash(password, 10);
    user = await User.create({ name: String(name).trim(), email: normalizedEmail, password: hashedPassword });

    const token = generateJWTToken(user._id);
    saveCookie(res, token, true);

    return res.status(200).json({
      success: true,
      message: "Registered successfully",
      user: toPublicUser(user)
    });
  }
);

export default registerUser;
