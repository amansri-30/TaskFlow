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
        return user;
    } catch (error) {
        return null;
    }
}