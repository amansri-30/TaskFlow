import { NextApiRequest, NextApiResponse } from "next";
import { handleRes } from "./resHandler";
import jwt from "jsonwebtoken";
import User from "@/models/userModel";
import cookie from "cookie";

export default async function isAuthenticated(req, res) {
    const cookies = cookie.parse(req.headers.cookie || "");
    const Token = cookies.token;
    if (!Token) return null;

    try {
        const decodedData = jwt.verify(Token, process.env.JWT_SECRET);
        const user = await User.findById(decodedData._id).select("-password");
        // Invalidate every JWT minted before the last password change, so a
        // password reset (or any future rotation) revokes previously-issued
        // sessions instead of silently trusting stolen old cookies.
        // `iat` is second-granular while the stamp is milliseconds. Subtracting
        // a second of slack let a token minted up to 999ms *before* the reset
        // survive, because its truncated `iat` compared as equal. Compare the
        // raw instants instead: a token whose second began before the change is
        // revoked. A login in the same second as a reset is conservatively
        // treated as old too; it can simply log in again.
        if (
            user &&
            user.passwordChangedAt &&
            decodedData.iat &&
            decodedData.iat * 1000 < new Date(user.passwordChangedAt).getTime()
        ) {
            return null;
        }
        return user;
    } catch (error) {
        return null;
    }
}