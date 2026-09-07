import { NextApiRequest, NextApiResponse } from "next";
import { handleRes } from "./resHandler";

type AsyncFunction = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

export const catchAsyncError = (asyncFunction: AsyncFunction) => (req: NextApiRequest, res: NextApiResponse) => {
  Promise.resolve(asyncFunction(req, res).catch((err) => {
    if (err?.name === "ValidationError") {
      return handleRes(res, 400, false, "Invalid input data.");
    }
    if (err?.code === 11000) {
      return handleRes(res, 409, false, "That value is already in use.");
    }
    return handleRes(res, 500, false, "Something went wrong on the server.");
  }))
};