import { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import Data from "@/models/dataModel";

const AboutMeData = catchAsyncError(async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "GET") {
        return handleRes(res, 405, false, "Only GET request is allowed");
    }
    await connectDB();

    // This is a static about-me page payload: return exactly one document.
    // Previously it dumped the entire Data collection AND passed a filter
    // object to findById, which ignored the intended single doc.
    const aboutData = await Data.findById("669bbffaba00f08895e4cd3f");

    return res.status(200).json({
        success: true,
        message: "Successfully fetched data",
        aboutData
    });
});

export default AboutMeData;