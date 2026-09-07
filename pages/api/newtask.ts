import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import Task from "@/models/taskModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import isAuthenticated from "@/middleware/isAuthenticated";

const newTask = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return handleRes(res, 400, false, "Only POST requests are allowed");

    await connectDB();

    const { taskTitle, description, dueDate, list, priority } = req.body;

    if (!taskTitle) return handleRes(res, 400, false, "Task Title is required");

    const validPriorities = ["low", "medium", "high"];
    if (priority && !validPriorities.includes(priority)) {
      return handleRes(res, 400, false, "Invalid priority. Use low, medium, or high.");
    }

    const user = await isAuthenticated(req, res);
    if (!user) return handleRes(res, 401, false, "No account is logged in");

    await Task.create({
      title: taskTitle,
      description: description || "",
      user: user._id,
      scheduledAt: dueDate,
      list,
      priority: priority || "medium",
    });

    handleRes(res, 200, true, "Task created successfully");
  }
);

export default newTask;
