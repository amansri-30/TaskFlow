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

    const { taskTitle, description, notes, dueDate, list, priority, recurrence, tags, monthlyDay, completed, completedAt, pinned, subtasks, trashed, trashedAt, remindAt, repeatUntil } = req.body || {};

    if (typeof taskTitle !== "string" || !taskTitle.trim())
      return handleRes(res, 400, false, "Task Title is required");

    const normalizedTitle = taskTitle.trim().slice(0, 120);

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
    // Description and notes are truncated, not rejected. PUT has always sliced
    // both (100 / 4000), and the import path normalizes the same way, so
    // rejecting here made create the odd entry point out: a duplicate or
    // backup carrying a long note failed with a 400 while the identical edit
    // was stored silently truncated.

    const user = await isAuthenticated(req, res);
    if (!user) return handleRes(res, 401, false, "No account is logged in");

    const effectiveRecurrence = recurrence || "none";
    // Same contract as PUT: an end date on a non-repeating task is meaningless,
    // so it is stripped rather than stored to reappear if recurrence is set later.
    let resolvedRepeatUntil: Date | null = null;
    if (effectiveRecurrence !== "none" && repeatUntil) {
      const parsedUntil = new Date(repeatUntil);
      if (isNaN(parsedUntil.getTime())) {
        return handleRes(res, 400, false, "Invalid repeat-until date");
      }
      resolvedRepeatUntil = parsedUntil;
    }
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
    // A malformed reminder used to be coerced to null and stored silently, so a
    // backup or duplicate carrying a corrupt reminder lost it with no error,
    // while the edit path answered the same input with a clean 400.
    if (remindAt && rawReminder && isNaN(rawReminder.getTime())) {
      return handleRes(res, 400, false, "Invalid reminder date");
    }
    const resolvedRemindAt =
      rawReminder && !isNaN(rawReminder.getTime()) ? rawReminder : null;
    // The edit path rejects a reminder that already elapsed, on the grounds that
    // it would fire on the very next client scan for a task the user has never
    // seen. Creation skipped that check, so the same reminder was accepted here
    // and stored already-due. Reject it identically instead of storing it.
    if (resolvedRemindAt && resolvedRemindAt.getTime() <= Date.now()) {
      return handleRes(res, 400, false, "Reminder must be in the future");
    }

    const normalizedList =
      typeof list === "string" && list.trim()
        ? list.trim().slice(0, 50)
        : "default";

    await Task.create({
      title: normalizedTitle,
      description: description ? String(description).slice(0, 100) : "",
      notes: typeof notes === "string" ? notes.slice(0, 4000) : "",
      user: user._id,
      // Validated above, so Mongoose receives a real Date or null rather than a
      // string it would have to cast — and reject with a 500 if it couldn't.
      scheduledAt: resolvedDueAt,
      remindAt: resolvedRemindAt,
      // `list` reached Mongoose raw, so a 5000-character name was stored and a
      // non-string one raised a CastError that `catchAsyncError` reported as
      // "Invalid id provided." -- a misleading 400 for a list field. PUT has
      // always required a trimmed string capped at 50; creation now matches.
      list: normalizedList,
      priority: priority || "medium",
      recurrence: effectiveRecurrence,
      repeatUntil: resolvedRepeatUntil,
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
