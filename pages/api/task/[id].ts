import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/connectDB";
import Task from "@/models/taskModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import isAuthenticated from "@/middleware/isAuthenticated";

const taskHandler = catchAsyncError(async (req: NextApiRequest, res: NextApiResponse) => {
  await connectDB();

  const user = await isAuthenticated(req, res);
  if (!user) return handleRes(res, 401, false, "No account is logged in");

  const { id } = req.query;

  switch (req.method) {
    case "GET": {
      const task = await Task.findOne({ _id: id, user: user._id });
      if (!task) return handleRes(res, 404, false, "Task not found");
      return handleRes(res, 200, true, "Task fetched", { task });
    }

    case "PUT": {
      const { taskTitle, description, dueDate, list } = req.body;
      const task = await Task.findOneAndUpdate(
        { _id: id, user: user._id },
        { title: taskTitle, description, scheduledAt: dueDate, list },
        { new: true, runValidators: true }
      );
      if (!task) return handleRes(res, 404, false, "Task not found");
      return handleRes(res, 200, true, "Task updated", { task });
    }

    case "DELETE": {
      const task = await Task.findOneAndDelete({ _id: id, user: user._id });
      if (!task) return handleRes(res, 404, false, "Task not found");
      return handleRes(res, 200, true, "Task deleted");
    }

    default:
      return handleRes(res, 405, false, "Method not allowed");
  }
});

export default taskHandler;
