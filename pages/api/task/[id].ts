import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/connectDB";
import Task from "@/models/taskModel";
import { handleRes } from "@/middleware/resHandler";
import { catchAsyncError } from "@/middleware/catchAsyncError";
import isAuthenticated from "@/middleware/isAuthenticated";
import {
  isRecurrence,
  nextOccurrenceDate,
} from "@/lib/recurrence";
import { normalizeTags } from "@/lib/tags";
import { normalizeSubtasks } from "@/lib/subtasks";

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

const setMonthlyDay = (task: any, dateValue: unknown) => {
  if (task.recurrence !== "monthly") {
    task.monthlyDay = null;
    return;
  }
  const source = dateValue ?? task.scheduledAt ?? null;
  const d = source ? new Date(source as string) : null;
  task.monthlyDay =
    d && !isNaN(d.getTime()) ? d.getDate() : task.monthlyDay ?? null;
};

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
      const { taskTitle, description, notes, dueDate, list, priority, recurrence, tags, subtasks, monthlyDay, remindAt } = req.body;
      const validPriorities = ["low", "medium", "high"];
      if (priority && !validPriorities.includes(priority)) {
        return handleRes(res, 400, false, "Invalid priority. Use low, medium, or high.");
      }
      if (recurrence !== undefined && !isRecurrence(recurrence)) {
        return handleRes(res, 400, false, "Invalid recurrence. Use none, daily, weekly, or monthly.");
      }
      if (taskTitle !== undefined) {
        if (typeof taskTitle !== "string" || !taskTitle.trim()) {
          return handleRes(res, 400, false, "Task Title is required");
        }
        task.title = taskTitle.trim().slice(0, 120);
      }
      if (description !== undefined) task.description = String(description).slice(0, 100);
      if (notes !== undefined) task.notes = String(notes).slice(0, 4000);
      if (list !== undefined) task.list = list;
      if (priority !== undefined) task.priority = priority;
      if (dueDate !== undefined) task.scheduledAt = dueDate || null;
      if (recurrence !== undefined) {
        task.recurrence = recurrence;
        // When recurring monthly, capture the anchor day-of-month from the
        // newly chosen due date so future occurrences never drift.
        setMonthlyDay(task, dueDate);
      }
      if (tags !== undefined) task.tags = normalizeTags(tags);
      if (subtasks !== undefined) task.subtasks = normalizeSubtasks(subtasks);
      if (remindAt !== undefined) {
        const reminder = remindAt ? new Date(remindAt) : null;
        if (reminder && isNaN(reminder.getTime())) {
          return handleRes(res, 400, false, "Invalid reminder date");
        }
        task.remindAt = reminder;
        // Any edit to the reminder re-arms it, so clearing remindedAt here is
        // what stops a stale "already fired" stamp from muting the new time.
        task.remindedAt = null;
      }
      if (monthlyDay !== undefined) {
        if (recurrence === "monthly" && Number.isInteger(monthlyDay)) {
          task.monthlyDay = Math.min(31, Math.max(1, monthlyDay));
        } else {
          setMonthlyDay(task, dueDate);
        }
      }
      task.updatedAt = new Date();
      await task.save();
      return handleRes(res, 200, true, "Task updated", { task: mapTask(task) });
    }

    case "PATCH": {
      const { completed, restore, pinned, priority, list, snooze, reminderFired } = req.body;

      if (restore === true) {
        task.trashed = false;
        task.trashedAt = null;
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task restored", { task: mapTask(task) });
      }

      if (reminderFired === true) {
        // Acknowledges a fired reminder so it can't notify again on every
        // poll. Clearing the reminder itself is a PUT, not a PATCH, so the
        // scheduled time survives until the user edits it.
        task.remindedAt = new Date();
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Reminder acknowledged", {
          task: mapTask(task),
        });
      }

      if (snooze === true) {
        if (!task.recurrence || task.recurrence === "none") {
          return handleRes(res, 400, false, "Only recurring tasks can be snoozed");
        }
        // Keep the same base-date rule as the complete branch: never compute a
        // next occurrence from a due date that already passed.
        const now = new Date();
        const scheduled = task.scheduledAt instanceof Date ? task.scheduledAt : null;
        const baseDate =
          scheduled && scheduled.getTime() > now.getTime() ? scheduled : now;
        const nextDue = nextOccurrenceDate(baseDate, task.recurrence, task.monthlyDay);
        if (!nextDue) {
          return handleRes(res, 400, false, "Could not compute a next occurrence");
        }
        task.scheduledAt = nextDue;
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task snoozed until the next occurrence", {
          task: mapTask(task),
        });
      }

      if (typeof pinned === "boolean") {
        task.pinned = pinned;
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task pin updated", {
          task: mapTask(task),
        });
      }

      if (typeof priority === "string" && ["low", "medium", "high"].includes(priority)) {
        task.priority = priority;
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task priority updated", {
          task: mapTask(task),
        });
      }

      if (typeof list === "string" && list.trim()) {
        task.list = list.trim().slice(0, 50);
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task list updated", {
          task: mapTask(task),
        });
      }

      if (typeof completed === "boolean") {
        task.completed = completed;
        task.completedAt = completed ? new Date() : null;
        task.updatedAt = new Date();
        await task.save();

        let nextTask: any = null;
        let removedNextTaskIds: string[] = [];

        // Undoing a completion of a recurring task: compensate the chain by
        // removing the pending occurrence(s) this task spawned, so a quick
        // complete→reopen doesn't leave a phantom future task behind.
        if (!completed && task.recurrence && task.recurrence !== "none") {
          const orphans = await Task.find({
            user: task.user,
            baseTaskId: task._id,
            completed: false,
            trashed: { $ne: true },
          });
          if (orphans.length > 0) {
            removedNextTaskIds = orphans.map((o: any) => o._id.toString());
            await Task.deleteMany({
              _id: { $in: orphans.map((o: any) => o._id) },
            });
          }
        }

        if (
          completed &&
          task.recurrence &&
          task.recurrence !== "none"
        ) {
          // Never derive the next occurrence from a due date that already
          // passed. Completing an overdue recurring task should still produce
          // a future occurrence; otherwise each completion keeps creating a
          // backdated one and the chain is permanently behind schedule.
          const now = new Date();
          const scheduled = task.scheduledAt instanceof Date ? task.scheduledAt : null;
          const baseDate =
            scheduled && scheduled.getTime() > now.getTime() ? scheduled : now;
          const nextDue = nextOccurrenceDate(baseDate, task.recurrence, task.monthlyDay);
          if (nextDue) {
            // Guard against a duplicate occurrence for the SAME chain only.
            // Dedupe on baseTaskId (the chain this task belongs to), never on
            // title+list: two independent tasks that merely share a title
            // would otherwise kill each other's recurrence — and the orphan
            // cleanup above would then delete the other chain's occurrence.
            const existing = await Task.findOne({
              user: task.user,
              baseTaskId: task._id,
              scheduledAt: nextDue,
              trashed: { $ne: true },
            });
            if (!existing) {
              // Carry the reminder onto the next occurrence, but only when the
              // gap between reminder and due date still holds — a reminder
              // that would land in the past is dropped rather than firing
              // instantly on a task nobody has seen yet.
              const reminder = task.remindAt instanceof Date ? task.remindAt : null;
              const leadMs = reminder && task.scheduledAt instanceof Date
                ? task.scheduledAt.getTime() - reminder.getTime()
                : 0;
              const nextRemindAt =
                reminder && leadMs > 0
                  ? new Date(nextDue.getTime() - leadMs)
                  : null;
              nextTask = await Task.create({
                title: task.title,
                description: task.description,
                notes: task.notes || "",
                list: task.list,
                priority: task.priority,
                user: task.user,
                recurrence: task.recurrence,
                scheduledAt: nextDue,
                remindAt: nextRemindAt,
                remindedAt: null,
                monthlyDay: task.monthlyDay,
                tags: task.tags || [],
                subtasks: task.subtasks || [],
                pinned: task.pinned,
                baseTaskId: task._id,
              });
            }
          }
        }

        return handleRes(res, 200, true, "Task status updated", {
          task: mapTask(task),
          nextTask: nextTask ? mapTask(nextTask) : null,
          removedNextTaskIds,
        });
      }
      return handleRes(res, 400, false, "Invalid completion status");
    }

    case "DELETE": {
      const permanent = req.query.permanent === "true";
      if (permanent) {
        await task.deleteOne();
        return handleRes(res, 200, true, "Task permanently deleted");
      }
      // Default: move to trash (recoverable) instead of hard-deleting.
      task.trashed = true;
      task.trashedAt = new Date();
      task.updatedAt = new Date();
      await task.save();
      return handleRes(res, 200, true, "Task moved to trash");
    }

    default:
      return handleRes(res, 405, false, "Method not allowed");
  }
});

export default taskHandler;
