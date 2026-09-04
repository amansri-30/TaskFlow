import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/connectDB";
import Task from "@/models/taskModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import isAuthenticated from "@/middleware/isAuthenticated";

const mapTask = (t: any) => ({
  id: t._id.toString(),
  title: t.title,
  description: t.description,
  list: t.list,
  scheduledAt: t.scheduledAt,
  completed: t.completed,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

const taskHandler = catchAsyncError(async (req: NextApiRequest, res: NextApiResponse) => {
  await connectDB();

  const user = await isAuthenticated(req, res);
  if (!user) return handleRes(res, 401, false, "No account is logged in");

  const { id } = req.query;
  if (typeof id !== "string") return handleRes(res, 400, false, "Invalid task id");

  const task = await Task.findOne({ _id: id, user: user._id });
  if (!task) return handleRes(res, 404, false, "Task not found");

  switch (req.method) {
    case "GET": {
      return handleRes(res, 200, true, "Task fetched", { task: mapTask(task) });
    }

    case "PUT": {
      const { taskTitle, description, dueDate, list } = req.body;
      task.title = taskTitle ?? task.title;
      if (description !== undefined) task.description = description;
      if (list !== undefined) task.list = list;
      if (dueDate !== undefined) task.scheduledAt = dueDate || null;
      task.updatedAt = new Date();
      await task.save();
      return handleRes(res, 200, true, "Task updated", { task: mapTask(task) });
    }

    case "PATCH": {
      const { completed } = req.body;
      if (typeof completed === "boolean") {
        task.completed = completed;
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task status updated", { task: mapTask(task) });
      }
      return handleRes(res, 400, false, "Invalid completion status");
    }

    case "DELETE": {
      await task.deleteOne();
      return handleRes(res, 200, true, "Task deleted");
    }

    default:
      return handleRes(res, 405, false, "Method not allowed");
  }
});

export default taskHandler;
