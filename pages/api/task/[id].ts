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

/**
 * Move a task's due date while keeping its reminder the same distance ahead of
 * it. A reminder that would land in the past is dropped rather than kept,
 * because the 30s client poll would fire it instantly.
 *
 * No-op when the date is unchanged. The Edit dialog always sends `dueDate`, so
 * saving an unrelated field used to re-anchor the reminder here: a reminder
 * whose lead had already elapsed was silently deleted, and a dateless task's
 * `remindedAt` was cleared, which re-fired a notification the user had already
 * acknowledged. Only a real move may re-arm.
 */
const moveDueDate = (task: any, nextDue: Date | null) => {
  const previousDue = task.scheduledAt instanceof Date ? task.scheduledAt : null;
  const unchanged =
    previousDue === null
      ? nextDue === null
      : nextDue !== null && previousDue.getTime() === nextDue.getTime();
  if (unchanged) return;

  task.scheduledAt = nextDue;
  if (task.remindAt instanceof Date && nextDue) {
    const leadMs = previousDue ? previousDue.getTime() - task.remindAt.getTime() : 0;
    if (leadMs > 0) {
      const shifted = new Date(nextDue.getTime() - leadMs);
      task.remindAt = shifted.getTime() > Date.now() ? shifted : null;
    }
  }
  // Re-arm: an acknowledged reminder must not suppress the newly moved time.
  task.remindedAt = null;
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
      if (dueDate !== undefined) {
        if (dueDate) {
          const parsed = new Date(dueDate);
          if (isNaN(parsed.getTime())) {
            return handleRes(res, 400, false, "Invalid due date");
          }
          moveDueDate(task, parsed);
        } else {
          moveDueDate(task, null);
        }
      }
      if (recurrence !== undefined) {
        task.recurrence = recurrence;
        // When recurring monthly, capture the anchor day-of-month from the
        // newly chosen due date so future occurrences never drift.
        setMonthlyDay(task, dueDate);
      } else if (dueDate !== undefined && monthlyDay === undefined) {
        // Re-anchor on a due-date-only edit too. Without this, dragging a
        // monthly task from the 1st to the 15th left the old anchor behind and
        // the next completion spawned the occurrence back on the 1st.
        setMonthlyDay(task, dueDate);
      }
      if (tags !== undefined) task.tags = normalizeTags(tags);
      if (subtasks !== undefined) task.subtasks = normalizeSubtasks(subtasks);
      if (remindAt !== undefined) {
        const reminder = remindAt ? new Date(remindAt) : null;
        if (reminder && isNaN(reminder.getTime())) {
          return handleRes(res, 400, false, "Invalid reminder date");
        }
        // A reminder in the past fires on the very next poll. The inline add
        // form, the row presets and the custom-time input all reject it; the
        // Edit dialog's raw datetime-local field did not, so a stale value
        // re-raised a notification the user had already dismissed.
        if (reminder && reminder.getTime() <= Date.now()) {
          return handleRes(res, 400, false, "Reminder must be in the future");
        }
        task.remindAt = reminder;
        // Any edit to the reminder re-arms it, so clearing remindedAt here is
        // what stops a stale "already fired" stamp from muting the new time.
        task.remindedAt = null;
      }
      if (monthlyDay !== undefined) {
        // `task.recurrence`, not the request body's `recurrence`: the body field
        // is undefined on any edit that doesn't restate it, so an already-monthly
        // task sent a bare `monthlyDay` fell into the else branch and had the
        // value silently discarded in favour of one re-derived from the due
        // date. The anchor is a property of the saved task, so compare against
        // what was actually just assigned above.
        if (task.recurrence === "monthly" && Number.isInteger(monthlyDay)) {
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
      const { completed, restore, pinned, priority, list, snooze, reminderFired, deferTo, scannedRemindAt } = req.body;

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
        //
        // Compare-and-set on the reminder time: the client sends the remindAt
        // it actually scanned, and the stamp is skipped if the reminder moved
        // meanwhile. The scan loop awaits one PATCH per task, so during a burst
        // of simultaneous reminders a reschedule of a later task re-armed
        // remindedAt = null and then had it overwritten by this write — the
        // freshly moved reminder was muted permanently.
        // An existing stamp is terminal, and this check is deliberately
        // unconditional: the `remindedAt` compare below stops a reschedule
        // from being muted by an in-flight acknowledgement, but on its own it
        // re-notified. A second tab polling inside the same window holds a
        // stale `remindedAt: null`, so it passes the due check and sends a
        // byte-identical request for a reminder that is already stamped. That
        // stamp is the only thing making delivery exactly-once across tabs.
        // Gating it on `scannedRemindAt` would let any caller that omits the
        // optional field re-stamp and re-notify, so the guarantee would depend
        // on client cooperation.
        if (task.remindedAt) {
          return handleRes(res, 200, true, "Reminder already acknowledged", {
            task: mapTask(task),
            acknowledged: false,
          });
        }
        if (scannedRemindAt !== undefined) {
          const current = task.remindAt instanceof Date ? task.remindAt.getTime() : null;
          const scanned = scannedRemindAt ? new Date(scannedRemindAt).getTime() : null;
          if (scanned === null || isNaN(scanned) || current !== scanned) {
            return handleRes(res, 200, true, "Reminder changed, not acknowledged", {
              task: mapTask(task),
              acknowledged: false,
            });
          }
        }
        task.remindedAt = new Date();
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Reminder acknowledged", {
          task: mapTask(task),
          acknowledged: true,
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
        // Snoozing moves the due date, so the reminder has to move with it.
        // Leaving it behind made the reminder fire immediately and, worse, left
        // an ~8-day gap that the recurrence lead-time logic then propagated to
        // every future occurrence. moveDueDate reads the OLD date, so the
        // assignment must happen inside it, not before.
        moveDueDate(task, nextDue);
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task snoozed until the next occurrence", {
          task: mapTask(task),
        });
      }

      // Reschedule: move a task's due date (or clear it). Applies to
      // non-recurring tasks too, which is the point — snooze is recurring-only.
      if (deferTo !== undefined) {
        if (task.trashed) {
          return handleRes(res, 400, false, "Restore the task before rescheduling it");
        }
        // Looked up before the branch so BOTH arms can act on the chain. The
        // loop used to live only in the date arm, so clearing a completed
        // recurring parent's due date left its pending occurrence dated — the
        // chain was half-cleared and re-anchored on the pre-clear day.
        const pending = await Task.find({
          user: task.user,
          baseTaskId: task._id,
          completed: false,
          trashed: { $ne: true },
        });
        const movedTasks: any[] = [];
        if (deferTo === null) {
          moveDueDate(task, null);
          task.monthlyDay = null;
          for (const child of pending) {
            moveDueDate(child, null);
            child.monthlyDay = null;
            child.updatedAt = new Date();
            await child.save();
            movedTasks.push(mapTask(child));
          }
        } else {
          const parsed = new Date(deferTo);
          if (isNaN(parsed.getTime())) {
            return handleRes(res, 400, false, "Invalid due date");
          }
          if (parsed.getTime() === (task.scheduledAt instanceof Date ? task.scheduledAt.getTime() : null)) {
            return handleRes(res, 200, true, "Task already has that due date", {
              task: mapTask(task),
              movedTasks: [],
            });
          }
          moveDueDate(task, parsed);
          // A moved monthly task must re-anchor, or the next completion spawns
          // on the old day-of-month.
          setMonthlyDay(task, parsed);
          // A pending occurrence of a recurring chain still sits on the old
          // date. Move it with the parent — including its reminder, so the
          // lead time survives instead of drifting a week every defer.
          for (const child of pending) {
            moveDueDate(child, parsed);
            // Re-anchor the child too. Moving it to the 20th while it kept
            // monthlyDay 15 made the next completion spawn back on the old
            // day, so the chain reverted to the pre-move anchor.
            setMonthlyDay(child, parsed);
            child.updatedAt = new Date();
            await child.save();
            movedTasks.push(mapTask(child));
          }
        }
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task rescheduled", {
          task: mapTask(task),
          // The children changed too, and the client reconciles from response
          // bodies rather than refetching. Returning only the parent left the
          // moved occurrence rendered with its pre-move date and reminder.
          movedTasks,
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
              try {
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
              } catch (spawnError: any) {
                // The findOne above is a check, not a lock, so a concurrent
                // completion can win the race and insert the same occurrence
                // first. The partial unique index on (baseTaskId, scheduledAt)
                // turns that into a duplicate-key error instead of a silently
                // forked chain — and because the winner already created the
                // occurrence we want, losing the race is a success, not a
                // failure. Anything else is a genuine failure and propagates.
                if (spawnError?.code !== 11000) throw spawnError;
                nextTask = await Task.findOne({
                  user: task.user,
                  baseTaskId: task._id,
                  scheduledAt: nextDue,
                });
              }
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
