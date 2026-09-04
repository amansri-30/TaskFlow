import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import Task from "@/models/taskModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import isAuthenticated from "@/middleware/isAuthenticated";

const getAllTasks = catchAsyncError(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") return handleRes(res, 400, false, "Only get request is allowed");

  await connectDB();

  const user = await isAuthenticated(req, res);
  if (!user) return handleRes(res, 401, false, "No account is logged in");

  const tasks = await Task.find({ user: user._id }).sort({ createdAt: -1 });

  const mapped = tasks.map((t) => ({
    id: t._id.toString(),
    title: t.title,
    description: t.description,
    list: t.list,
    scheduledAt: t.scheduledAt,
    completed: t.completed,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  handleRes(res, 200, true, "Fetched all tasks", { tasks: mapped });
});

export default getAllTasks;