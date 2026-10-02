import connectDB from "@/lib/connectDB";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import { handleRes } from "@/middleware/resHandler";
import User from "@/models/userModel";
import { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcrypt";
import { saveCookie } from "@/lib/saveCookies";
import generateJWTToken from "@/lib/generateJwtToken";


// A real bcrypt hash of a value nobody can supply. Comparing against it when
// the email is unknown makes the "no such account" path pay the same CPU cost as
// a real check, so response latency stops revealing which emails are registered.
const DUMMY_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const logIn = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return handleRes(res, 405, false, "Only post request is allowed");

    const {email, password} = req.body;
    // Type-check, not just truthiness: `bcrypt.compare` rejects a non-string
    // with "data and hash must be strings", and that error matches nothing in
    // catchAsyncError, so a JSON body of `{"password": 123}` surfaced as a 500
    // instead of the 400 this input deserves.
    if (typeof email !== "string" || typeof password !== "string" || !email || !password)
      return handleRes(res, 400, false, "All fields required!!!");

    // Look up with the same normalization used at registration so a user who
    // signed up with mixed-case email can always log in.
    const normalizedEmail = String(email).trim().toLowerCase();

    await connectDB();

    const userWithPassword = await User.findOne({email: normalizedEmail}).select("+password");
    if (!userWithPassword) {
      // Spend the same time hashing as a genuine attempt before bailing out.
      await bcrypt.compare(password, DUMMY_HASH);
      return handleRes(res, 400, false, "Invalid email or password");
    }

    const passwordMatched = await bcrypt.compare(password, userWithPassword.password);
    if (!passwordMatched) return handleRes(res, 400, false, "Invalid email or password");

    const user = await User.findOne({email: normalizedEmail});

    const token = generateJWTToken(user._id);
    saveCookie(res, token, true);
    res.status(200).json({
      success: true,
      message: `Welcome back ${user.name}`,
      user
    })
  }
);
export default logIn;