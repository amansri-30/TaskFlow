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

    // A JSON body can carry any type here, and `String(name).trim()` cheerfully
    // stores "[object Object]" as a display name. Bound the type and the length
    // at the boundary: the input has a cap in the UI, a direct POST does not,
    // and 80 characters is what every other view in the app can render.
    const displayName = typeof name === "string" ? name.trim() : "";
    if (!displayName) return handleRes(res, 400, false, "Please enter your name");
    if (displayName.length > 80)
      return handleRes(res, 400, false, "Name cannot exceed 80 characters");

    // Store the email normalized (trim + lowercase) so lookup is case-insensitive
    // everywhere — otherwise a mixed-case signup could be locked out.
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    // Deliberately permissive: it only rejects strings that could not be an
    // address at all, instead of trying to out-guess the RFC.
    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return handleRes(res, 400, false, "Enter a valid email address");
    }

    await connectDB();
    let user = await User.findOne({ email: normalizedEmail });
    if (user) return handleRes(res, 400, false, "Email already registered. Try logging in.");

    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      user = await User.create({ name: displayName, email: normalizedEmail, password: hashedPassword });
    } catch (err) {
      // Two signups for the same address can both clear the lookup above before
      // either insert lands. The unique index is the real guard, and its error
      // used to escape to catchAsyncError, which answers "That value is already
      // in use." — a 409 that names no field, so the form could only shrug.
      if ((err as { code?: number })?.code === 11000) {
        return handleRes(res, 400, false, "Email already registered. Try logging in.");
      }
      throw err;
    }

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
