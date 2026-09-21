import { NextApiRequest, NextApiResponse } from "next";
import { handleRes } from "./resHandler";

type AsyncFunction = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

export const catchAsyncError = (asyncFunction: AsyncFunction) => (req: NextApiRequest, res: NextApiResponse) => {
  Promise.resolve(asyncFunction(req, res).catch((err) => {
    if (err?.name === "ValidationError") {
      // Surface the actionable schema message (e.g. "Task title cannot
      // exceed 120 characters") instead of a generic error string.
      const first = err?.errors ? Object.values(err.errors)[0] : null;
      const message =
        (first as { message?: string } | undefined)?.message ||
        "Invalid input data.";
      return handleRes(res, 400, false, message);
    }
    if (err?.name === "CastError") {
      // Malformed ids (e.g. /api/task/abc) are a client error, not a 500.
      return handleRes(res, 400, false, "Invalid id provided.");
    }
    if (err?.code === 11000) {
      return handleRes(res, 409, false, "That value is already in use.");
    }
    return handleRes(res, 500, false, "Something went wrong on the server.");
  }))
};