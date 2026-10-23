import connectDB from "@/lib/connectDB";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import { handleRes } from "@/middleware/resHandler";
import User from "@/models/userModel";
import { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcrypt";
import { saveCookie } from "@/lib/saveCookies";
import generateJWTToken from "@/lib/generateJwtToken";
import { toPublicUser } from "@/lib/publicUser";
import { rateLimit, clientKey } from "@/lib/rateLimit";


// A real bcrypt hash of a value nobody can supply. Comparing against it when
// the email is unknown makes the "no such account" path pay the same CPU cost as
// a real check, so response latency stops revealing which emails are registered.
const DUMMY_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

// Sign-in throttling. bcrypt at cost 10 is deliberately slow, which bounds an
// attacker's request rate per connection but does nothing about volume: the
// endpoint accepted an unbounded stream of guesses against a known address, so
// an online dictionary could be run at whatever the network allowed.
const MAX_ATTEMPTS = 8;
// Escalating, so a sustained attack gets slower without penalising a user who
// fat-fingered a password once or twice. Indexed by how many lockouts the
// account has already accumulated, so the first is a short 60s and only a
// repeat offender reaches the hour-long window.
const LOCKOUT_MS = [60_000, 300_000, 900_000, 3_600_000];

const lockoutDuration = (lockoutCount: number) =>
  LOCKOUT_MS[Math.min(Math.max(lockoutCount - 1, 0), LOCKOUT_MS.length - 1)];

const logIn = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return handleRes(res, 405, false, "Only post request is allowed");

    // Per-account lockout bounds guesses against one address, but an attacker
    // can rotate addresses freely from a single host. This caps the source:
    // generous enough for a shared office/NAT IP, far below spray volume.
    if (!rateLimit(`login:${clientKey(req)}`, 30, 15 * 60_000)) {
      return handleRes(res, 429, false, "Too many attempts. Please try again later");
    }

    const {email, password} = req.body || {};
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

    const userWithPassword = await User.findOne({email: normalizedEmail})
      .select("+password +loginAttempts +lockedUntil");
    if (!userWithPassword) {
      // Spend the same time hashing as a genuine attempt before bailing out.
      await bcrypt.compare(password, DUMMY_HASH);
      return handleRes(res, 400, false, "Invalid email or password");
    }

    // Refused before hashing, so a locked account cannot be used to burn server
    // CPU. The message is the same one a wrong password gets, because "this
    // account is locked" would confirm the address is registered and hand an
    // attacker a target.
    const now = new Date();
    if (userWithPassword.lockedUntil && userWithPassword.lockedUntil > now) {
      const minutes = Math.max(
        1,
        Math.ceil((userWithPassword.lockedUntil.getTime() - now.getTime()) / 60000)
      );
      return handleRes(
        res,
        429,
        false,
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}`
      );
    }

    const passwordMatched = await bcrypt.compare(password, userWithPassword.password);
    if (!passwordMatched) {
      // Count this failure atomically: `$inc` advances the tally on the document
      // itself, so N concurrent guesses each contribute instead of all writing
      // back the same stale count they read before the ~100ms bcrypt compare.
      // Reading then `$set`-ing the old value let a parallel burst never climb
      // past 1, so the threshold lockout never engaged. A lockout whose window
      // has already elapsed resets the tally before this failure is counted.
      await User.updateOne(
        { _id: userWithPassword._id, lockedUntil: { $ne: null, $lte: now } },
        { $set: { loginAttempts: 0, lockedUntil: null } }
      );
      const afterFailure = await User.findOneAndUpdate(
        { _id: userWithPassword._id },
        { $inc: { loginAttempts: 1 } },
        { new: true }
      ).select("+loginAttempts");
      const attempts = afterFailure?.loginAttempts ?? 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Escalate off a persisted count of prior lockouts, not the attempt
        // tally: `attempts` resets each time a lockout expires, so keying the
        // window off it always produced the longest tier — the shortest three
        // were unreachable and a user who mistyped eight times got a full hour.
        const locked = await User.findOneAndUpdate(
          { _id: userWithPassword._id },
          { $inc: { lockoutCount: 1 } },
          { new: true }
        ).select("+lockoutCount");
        const count = locked?.lockoutCount ?? 1;
        await User.updateOne(
          { _id: userWithPassword._id },
          { $set: { lockedUntil: new Date(Date.now() + lockoutDuration(count)) } }
        );
      }
      return handleRes(res, 400, false, "Invalid email or password");
    }

    // Correct password: clear the tally so a legitimate user who fumbled twice
    // is not left one typo away from a lockout, and reset the lockout count so
    // the escalation starts over.
    if (
      (userWithPassword.loginAttempts || 0) > 0 ||
      userWithPassword.lockedUntil
    ) {
      await User.updateOne(
        {_id: userWithPassword._id},
        {$set: {loginAttempts: 0, lockedUntil: null, lockoutCount: 0}}
      );
    }

    // Re-read without the secret fields, so the locked-out bookkeeping is never
    // serialized into the response.
    const user = await User.findOne({email: normalizedEmail});

    const token = generateJWTToken(user._id);
    saveCookie(res, token, true);
    res.status(200).json({
      success: true,
      message: `Welcome back ${user.name}`,
      user: toPublicUser(user)
    })
  }
);
export default logIn;