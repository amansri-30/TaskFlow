import { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import isAuthenticated from "@/middleware/isAuthenticated";
import { toPublicUser } from "@/lib/publicUser";

const Profile = catchAsyncError(async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "GET") {
        return handleRes(res, 405, false, "Only GET request is allowed");
    }

    await connectDB();

    const user = await isAuthenticated(req, res);

    if (!user) {
        return handleRes(res, 401, false, "No account is logged in");
    }

    // Whitelist, not the whole document. The client only needs identity, and
    // serializing the Mongoose doc shipped every non-secret schema field
    // (resetPasswordExpire, passwordChangedAt, ...) to the browser — state that
    // nothing renders, and that would leak any column added later by default.
    return res.status(200).json({
        success: true,
        message: "My Profile",
        user: toPublicUser(user)
    });
});

export default Profile;
