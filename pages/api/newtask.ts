import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "../../lib/connectDB";
import Task from "@/models/taskModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import isAuthenticated from "@/middleware/isAuthenticated";
import { isRecurrence } from "@/lib/recurrence";
import { normalizeTags } from "@/lib/tags";
import { normalizeSubtasks } from "@/lib/subtasks";

const newTask = catchAsyncError(
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return handleRes(res, 405, false, "Only POST requests are allowed");

    await connectDB();

    const { taskTitle, description, notes, dueDate, list, priority, recurrence, tags, monthlyDay, completed, completedAt, pinned, subtasks, trashed, trashedAt, remindAt } = req.body;

    if (!taskTitle || !String(taskTitle).trim())
      return handleRes(res, 400, false, "Task Title is required");

    const normalizedTitle = String(taskTitle).trim().slice(0, 120);

    const validPriorities = ["low", "medium", "high"];
    if (priority && !validPriorities.includes(priority)) {
      return handleRes(res, 400, false, "Invalid priority. Use low, medium, or high.");
    }

    if (recurrence !== undefined && !isRecurrence(recurrence)) {
      return handleRes(res, 400, false, "Invalid recurrence. Use none, daily, weekly, or monthly.");
    }

    // Create has to enforce the same input contract as PUT, or the two entry
    // points disagree: PUT validated the date and capped description/notes,
    // while here they went straight to Mongoose. A malformed date then raised a
    // CastError and a long description a ValidationError, so the client saw an
    // opaque 500 for input the edit path answered with a clean 400. Validate
    // first and the failure is reported instead of thrown.
    let resolvedDueAt: Date | null = null;
    if (dueDate) {
      const parsedDue = new Date(dueDate);
      if (isNaN(parsedDue.getTime())) {
        return handleRes(res, 400, false, "Invalid due date");
      }
      resolvedDueAt = parsedDue;
    }
    let resolvedCompletedAt: Date | null = null;
    if (completed === true) {
      if (completedAt) {
        const parsedCompleted = new Date(completedAt);
        if (isNaN(parsedCompleted.getTime())) {
          return handleRes(res, 400, false, "Invalid completion date");
        }
        resolvedCompletedAt = parsedCompleted;
      } else {
        resolvedCompletedAt = new Date();
      }
    }
    if (description && String(description).length > 100) {
      return handleRes(res, 400, false, "Description cannot exceed 100 characters");
    }
    if (notes && String(notes).length > 4000) {
      return handleRes(res, 400, false, "Notes cannot exceed 4000 characters");
    }

    const user = await isAuthenticated(req, res);
    if (!user) return handleRes(res, 401, false, "No account is logged in");

    const effectiveRecurrence = recurrence || "none";
    const clientMonthlyDay =
      Number.isInteger(monthlyDay) && effectiveRecurrence === "monthly"
        ? Math.min(31, Math.max(1, monthlyDay))
        : null;
    // The client sends the day-of-month anchored to the user's local calendar;
    // fall back to the server-side day only when it didn't.
    const resolvedMonthlyDay =
      clientMonthlyDay ??
      (effectiveRecurrence === "monthly" && resolvedDueAt
        ? resolvedDueAt.getDate()
        : null);

    const normalizedCompleted = typeof completed === "boolean" ? completed : false;
    // A backup exported from the Trash view re-imports into the Trash, so a
    // restore never silently revives deleted work as active duplicates.
    const importedTrashed = trashed === true;
    const rawTrashedAt = importedTrashed && trashedAt ? new Date(trashedAt) : null;
    const resolvedTrashedAt =
      importedTrashed && rawTrashedAt && !isNaN(rawTrashedAt.getTime())
        ? rawTrashedAt
        : importedTrashed
        ? new Date()
        : null;

    const rawReminder = remindAt ? new Date(remindAt) : null;
    const resolvedRemindAt =
      rawReminder && !isNaN(rawReminder.getTime()) ? rawReminder : null;

    await Task.create({
      title: normalizedTitle,
      description: description || "",
      notes: typeof notes === "string" ? notes.slice(0, 4000) : "",
      user: user._id,
      // Validated above, so Mongoose receives a real Date or null rather than a
      // string it would have to cast — and reject with a 500 if it couldn't.
      scheduledAt: resolvedDueAt,
      remindAt: resolvedRemindAt,
      list,
      priority: priority || "medium",
      recurrence: effectiveRecurrence,
      monthlyDay: resolvedMonthlyDay,
      tags: normalizeTags(tags),
      subtasks: normalizeSubtasks(subtasks),
      completed: normalizedCompleted,
      completedAt: normalizedCompleted ? resolvedCompletedAt : null,
      pinned: typeof pinned === "boolean" ? pinned : false,
      trashed: importedTrashed,
      trashedAt: resolvedTrashedAt,
    });

    handleRes(res, 200, true, "Task created successfully");
  }
);

export default newTask;
