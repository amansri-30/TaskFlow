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