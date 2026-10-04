import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import Task from "@/models/taskModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import isAuthenticated from "@/middleware/isAuthenticated";

const getAllTasks = catchAsyncError(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") return handleRes(res, 405, false, "Only get request is allowed");

  await connectDB();

  const user = await isAuthenticated(req, res);
  if (!user) return handleRes(res, 401, false, "No account is logged in");

  // The notification bell only needs a due date, a title and a completion flag,
  // but it was calling this endpoint and receiving every field of every task --
  // notes up to 4000 characters and up to 100 subtasks each -- on mount, on
  // every window focus and on every popover open, from a component that is
  // mounted twice (the desktop sidebar is only CSS-hidden at mobile widths, so
  // its instance is still live). That made a decorative badge one of the
  // heaviest requests in the app. `?alerts=1` asks for the short shape only.
  const slim = req.query.alerts === "1";
  const projection = slim
    ? { title: 1, scheduledAt: 1, completed: 1 }
    : {};

  const [tasks, trashed] = await Promise.all([
    Task.find({ user: user._id, trashed: { $ne: true } }, projection)
      .sort({ createdAt: -1 })
      // Plain objects, not hydrated documents: nothing here mutates or saves a
      // result, and skipping the Mongoose document machinery is a large part of
      // the cost of a query this size.
      .lean(),
    Task.find({ user: user._id, trashed: true }, projection)
      .sort({ trashedAt: -1 })
      .lean(),
  ]);

  if (slim) {
    return handleRes(res, 200, true, "Fetched alerts", {
      tasks: tasks.map((t: any) => ({
        id: t._id.toString(),
        title: t.title,
        scheduledAt: t.scheduledAt,
        completed: !!t.completed,
      })),
    });
  }

  const mapTask = (t: any) => ({
    id: t._id.toString(),
    title: t.title,
    description: t.description,
    notes: t.notes || "",
    list: t.list,
    priority: t.priority,
    scheduledAt: t.scheduledAt,
    remindAt: t.remindAt,
    remindedAt: t.remindedAt,
    completed: t.completed,
    completedAt: t.completedAt,
    recurrence: t.recurrence,
    monthlyDay: t.monthlyDay,
    tags: t.tags || [],
    subtasks: (t.subtasks || []).map((s: any) => ({
      id: s._id ? s._id.toString() : s.id,
      text: s.text,
      completed: !!s.completed,
      createdAt: s.createdAt,
    })),
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