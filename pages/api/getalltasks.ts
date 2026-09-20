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

  const [tasks, trashed] = await Promise.all([
    Task.find({ user: user._id, trashed: { $ne: true } }).sort({ createdAt: -1 }),
    Task.find({ user: user._id, trashed: true }).sort({ trashedAt: -1 }),
  ]);

  const mapTask = (t: any) => ({
    id: t._id.toString(),
    title: t.title,
    description: t.description,
    list: t.list,
    priority: t.priority,
    scheduledAt: t.scheduledAt,
    completed: t.completed,
    completedAt: t.completedAt,
    recurrence: t.recurrence,
    monthlyDay: t.monthlyDay,
    tags: t.tags || [],
    pinned: t.pinned,
    trashed: t.trashed,
    trashedAt: t.trashedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  });

  handleRes(res, 200, true, "Fetched all tasks", {
    tasks: tasks.map(mapTask),
    trashed: trashed.map(mapTask),
  });
});

export default getAllTasks;