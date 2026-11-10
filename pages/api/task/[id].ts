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
  repeatUntil: t.repeatUntil || null,
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

/**
 * Every unfinished, non-trashed occurrence below a task in its recurrence
 * chain.
 *
 * `baseTaskId` points at the *immediate* parent, not the chain root, and a
 * chain can hold completed rows in the middle: complete A (spawns B), reopen A
 * (B is already completed so it survives the reopen cleanup), complete A again
 * (spawns C under A). Deleting A used to look exactly one level down and see
 * only B -- completed, so nothing was deleted -- and left C alive as a phantom
 * future task. Walking parent links through history is the only way to reach
 * the pending tail.
 *
 * `$graphLookup` does that traversal in one round trip and bounds the recursion,
 * instead of issuing one query per generation (which a months-old daily chain
 * would turn into hundreds of round trips). Trashed rows are followed through
 * but not returned: they are already out of the user's working list, and a
 * permanent delete must not silently destroy rows sitting in Trash.
 */
const pendingDescendantIds = async (task: any): Promise<any[]> => {
  const [result] = await Task.aggregate([
    { $match: { _id: task._id } },
    {
      $graphLookup: {
        from: Task.collection.name,
        startWith: "$_id",
        connectFromField: "_id",
        connectToField: "baseTaskId",
        as: "descendants",
        maxDepth: 500,
        restrictSearchWithMatch: { user: task.user },
      },
    },
    { $project: { descendants: { _id: 1, completed: 1, trashed: 1 } } },
  ]);
  const rows = ((result && result.descendants) || []) as any[];
  return rows
    .filter((row) => !row.completed && !row.trashed)
    .map((row) => row._id);
};

const setMonthlyDay = (task: any, dateValue: unknown, clientDay?: unknown) => {
  if (task.recurrence !== "monthly") {
    task.monthlyDay = null;
    return;
  }
  // Prefer the day-of-month the client read off the user's own calendar. An
  // absolute instant cannot answer this question: `getDate()` resolves in the
  // server's timezone, so a user east of UTC rescheduling to the 15th at
  // 00:00 local sent an instant that is still the 14th in UTC, and the anchor
  // was silently stored as 14. The due date still rendered correctly, so nothing
  // looked wrong -- until the task completed and every future occurrence spawned
  // a day early. `newtask` already takes this field for exactly this reason.
  if (Number.isInteger(clientDay)) {
    task.monthlyDay = Math.min(31, Math.max(1, clientDay as number));
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
  if (task.remindAt instanceof Date) {
    if (nextDue === null) {
      // The date was cleared. An already-fired reminder must be dropped here:
      // `remindedAt` is reset below (to re-arm a genuine move), and leaving a
      // past `remindAt` armed next to a cleared `remindedAt` re-raised a
      // notification the user had already acknowledged.
      if (task.remindAt.getTime() <= Date.now()) task.remindAt = null;
    } else if (previousDue) {
      // Carry the reminder by the same offset it had relative to the old due
      // date. The lead may legitimately be negative: a reminder can be set
      // *after* the due date as a follow-up nudge, and shifting only
      // non-negative leads pinned that reminder to its old instant, so it fired
      // at the wrong moment (or immediately) once the date moved. Zero lead
      // ("at time of task") is handled by the same arithmetic.
      const leadMs = previousDue.getTime() - task.remindAt.getTime();
      const shifted = new Date(nextDue.getTime() - leadMs);
      task.remindAt = shifted.getTime() > Date.now() ? shifted : null;
    } else if (task.remindAt.getTime() <= Date.now()) {
      // A dateless task being given a date: an elapsed reminder is stale.
      task.remindAt = null;
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
      const { taskTitle, description, notes, dueDate, list, priority, recurrence, tags, subtasks, monthlyDay, remindAt, repeatUntil } = req.body || {};
      const validPriorities = ["low", "medium", "high"];
      // `priority &&` let an explicit `null` through the guard untouched, and
      // the assignment below then wrote it -- Mongoose's enum validator skips
      // null, so the row was stored outside low|medium|high. Creation coerced
      // null to "medium", so the two entry points disagreed. Test for
      // "provided" rather than "truthy".
      if (priority !== undefined && !validPriorities.includes(priority)) {
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
      if (typeof list === "string" && list.trim()) task.list = list.trim().slice(0, 50);
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
      // Repeat-until is an attribute of the series, so it is accepted for any
      // recurrence (including "none", which clears it) and stripped whenever
      // the stored recurrence is none — an end date on a non-repeating task is
      // meaningless state that would silently reappear if recurrence is set
      // again later.
      if (repeatUntil !== undefined) {
        if (repeatUntil === null || repeatUntil === "") {
          task.repeatUntil = null;
        } else {
          const parsedUntil = new Date(repeatUntil);
          if (isNaN(parsedUntil.getTime())) {
            return handleRes(res, 400, false, "Invalid repeat-until date");
          }
          task.repeatUntil = parsedUntil;
        }
      }
      if (task.recurrence === "none") task.repeatUntil = null;
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
      const { completed, restore, pinned, priority, list, tags, snooze, reminderFired, deferTo, scannedRemindAt, monthlyDay, remindAt } = req.body || {};

      if (restore === true) {
        task.trashed = false;
        task.trashedAt = null;
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task restored", { task: mapTask(task) });
      }

      if (reminderFired === true) {
        // Acknowledges a fired reminder so it can't notify again on every
        // poll. This leaves the reminder itself in place so the scheduled time
        // survives until the user edits or clears it (a PUT/PATCH of
        // `remindAt`, which clears this stamp).
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
        // Re-anchor a monthly series on the snoozed date, otherwise the next
        // completion spawns on the pre-snooze day-of-month.
        setMonthlyDay(task, nextDue);
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
            child.repeatUntil = task.repeatUntil || null;
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
          setMonthlyDay(task, parsed, monthlyDay);
          // A pending occurrence of a recurring chain still sits on the old
          // date. Move it with the parent — including its reminder, so the
          // lead time survives instead of drifting a week every defer.
          for (const child of pending) {
            moveDueDate(child, parsed);
            // Re-anchor the child too. Moving it to the 20th while it kept
            // monthlyDay 15 made the next completion spawn back on the old
            // day, so the chain reverted to the pre-move anchor.
            setMonthlyDay(child, parsed, monthlyDay);
            child.repeatUntil = task.repeatUntil || null;
            child.updatedAt = new Date();
            await child.save();
            movedTasks.push(mapTask(child));
          }
        }
        // Undo of a reschedule replays the reminder that existed before the
        // move. Deriving it from the current lead cannot restore one the
        // forward move dropped for landing in the past, so an explicitly
        // supplied `remindAt` wins over the derived value. A recorded instant
        // that is already past by replay time is dropped, matching the rule
        // `moveDueDate` uses, instead of firing on the next poll.
        if (remindAt !== undefined) {
          if (remindAt) {
            const explicit = new Date(remindAt);
            if (isNaN(explicit.getTime())) {
              return handleRes(res, 400, false, "Invalid reminder date");
            }
            task.remindAt = explicit.getTime() > Date.now() ? explicit : null;
          } else {
            task.remindAt = null;
          }
          task.remindedAt = null;
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

      // Field-scoped tag write, so bulk tagging from the batch toolbar can reuse
      // this endpoint and the client's PATCH-shaped undo entries can replay it.
      // `tags` replaces the whole set rather than merging, which is what lets a
      // single-tag removal express itself as "here is the set minus one".
      if (tags !== undefined) {
        // Accept a comma-separated string like create/PUT do (`normalizeTags`
        // handles both shapes). A non-array, non-string value gets a message
        // about tags rather than falling through to "Invalid completion status",
        // which had nothing to do with the actual problem.
        if (!Array.isArray(tags) && typeof tags !== "string") {
          return handleRes(res, 400, false, "Tags must be an array of strings");
        }
        task.tags = normalizeTags(tags);
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task tags updated", {
          task: mapTask(task),
        });
      }

      // Field-scoped reminder write, the PATCH sibling of the PUT arm. Bulk
      // reminder actions and their undo entries need to touch one field without
      // restating a whole task, exactly like priority/list/tags above. The
      // validation is deliberately identical to PUT: a malformed or elapsed
      // reminder must not be stored, because the 30s client scan would fire it
      // instantly for a task the user has never seen.
      if (remindAt !== undefined) {
        const reminder = remindAt ? new Date(remindAt) : null;
        if (reminder && isNaN(reminder.getTime())) {
          return handleRes(res, 400, false, "Invalid reminder date");
        }
        if (reminder && reminder.getTime() <= Date.now()) {
          return handleRes(res, 400, false, "Reminder must be in the future");
        }
        task.remindAt = reminder;
        // Any reminder write re-arms it, so a stale acknowledgement cannot mute
        // the new time. Clearing sets both fields to null.
        task.remindedAt = null;
        task.updatedAt = new Date();
        await task.save();
        return handleRes(res, 200, true, "Task reminder updated", {
          task: mapTask(task),
        });
      }

      if (typeof completed === "boolean") {
        // A completion is not idempotent by accident, so make it explicit. This
        // branch derives the next occurrence from `new Date()` when the task has
        // no future due date, which is millisecond-precise and different on every
        // request — so a retried PATCH, a double-click, or a second tab all passed
        // the dedupe below and each inserted an occurrence, forking the chain
        // with phantom future tasks. Completing an already-completed task is
        // therefore a no-op rather than a second spawn.
        if (task.completed === completed) {
          return handleRes(res, 200, true, "Task already up to date", {
            task: mapTask(task),
          });
        }

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
          // The series can have an end: once the next occurrence would land
          // past `repeatUntil`, this completion is the last one and no
          // successor is spawned.
          const until = task.repeatUntil instanceof Date ? task.repeatUntil : null;
          if (nextDue && (!until || nextDue.getTime() <= until.getTime())) {
            // Drop sub-second precision so two requests completing the same task
            // within one second derive an identical nextDue and collide on the
            // partial unique index below, instead of each spawning an occurrence
            // that differs only in milliseconds. A todo due date has no use for
            // millisecond accuracy, and the dedupe lookup is exact-match.
            nextDue.setMilliseconds(0);
            // A date can already be occupied by a completed or trashed
            // occurrence. Those rows are history, but they still collide with
            // the partial unique index, and the old exact-date check treated
            // them as a live successor — so completing a recurring task after
            // reopening it, or after trashing its only pending occurrence,
            // silently ended the chain. Read the chain's dates once and split
            // them: an unfinished non-trashed row is the dedupe hit we want,
            // while history is skipped until we reach a date with no row.
            const futureOccurrences = await Task.find({
              user: task.user,
              baseTaskId: task._id,
              scheduledAt: { $gte: nextDue },
            })
              .select("scheduledAt completed trashed")
              .lean();
            const historyDates = new Set<number>();
            const liveDates = new Set<number>();
            for (const occurrence of futureOccurrences as any[]) {
              const at =
                occurrence.scheduledAt instanceof Date
                  ? occurrence.scheduledAt
                  : null;
              if (!at || isNaN(at.getTime())) continue;
              at.setMilliseconds(0);
              const key = at.getTime();
              if (occurrence.completed || occurrence.trashed) {
                historyDates.add(key);
              } else {
                liveDates.add(key);
              }
            }
            // Step forward one cadence at a time. The loop is bounded by the
            // number of historical rows returned above, and the guard on
            // `advanced` prevents a malformed recurrence from spinning.
            let candidate: Date | null = nextDue;
            while (
              candidate &&
              (!until || candidate.getTime() <= until.getTime()) &&
              historyDates.has(candidate.getTime()) &&
              !liveDates.has(candidate.getTime())
            ) {
              const advanced = nextOccurrenceDate(
                candidate,
                task.recurrence,
                task.monthlyDay
              );
              if (!advanced || advanced.getTime() <= candidate.getTime()) {
                candidate = null;
                break;
              }
              advanced.setMilliseconds(0);
              candidate = advanced;
            }
            if (
              candidate &&
              (!until || candidate.getTime() <= until.getTime()) &&
              !liveDates.has(candidate.getTime())
            ) {
              // Carry the reminder onto the next occurrence with the same offset
              // it had on this one, before or after the due date. A post-due
              // nudge (negative lead) used to be dropped from every successor
              // because only non-negative leads were shifted; the offset is now
              // preserved, and only an instant that would already be in the past
              // is dropped rather than firing instantly on a task nobody has
              // seen yet.
              const reminder = task.remindAt instanceof Date ? task.remindAt : null;
              const leadMs = reminder && task.scheduledAt instanceof Date
                ? task.scheduledAt.getTime() - reminder.getTime()
                : 0;
              let nextRemindAt: Date | null = null;
              if (reminder) {
                const shifted = new Date(candidate.getTime() - leadMs);
                nextRemindAt = shifted.getTime() > Date.now() ? shifted : null;
              }
              try {
                nextTask = await Task.create({
                  title: task.title,
                  description: task.description,
                  notes: task.notes || "",
                  list: task.list,
                  priority: task.priority,
                  user: task.user,
                  recurrence: task.recurrence,
                  scheduledAt: candidate,
                  remindAt: nextRemindAt,
                  remindedAt: null,
                  monthlyDay: task.monthlyDay,
                  // Carry the series end date onto the successor, otherwise the
                  // first completion silently dropped the bound and the task
                  // kept repeating past "until".
                  repeatUntil: task.repeatUntil || null,
                  tags: task.tags || [],
                  // Unticked, and without the parent's subtask ids: the parent's
                  // boxes were ticked on the way to completion, so copying them
                  // verbatim made every new occurrence arrive "3/3 done" and the
                  // user had to untick the whole list before starting again.
                  subtasks: (task.subtasks || []).map((s: any) => ({
                    text: s.text,
                    completed: false,
                  })),
                  pinned: task.pinned,
                  baseTaskId: task._id,
                });
              } catch (spawnError: any) {
                // The query above is a check, not a lock, so a concurrent
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
                  scheduledAt: candidate,
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
      const series = req.query.series === "true";
      // Resolved before the branch: a permanent delete always takes the pending
      // tail, while a soft delete takes it only when the caller asked for the
      // whole series. A plain single-row trash skips the traversal entirely.
      const pendingIds =
        permanent || series ? await pendingDescendantIds(task) : [];

      if (permanent) {
        // Completing a recurring task spawns a successor tagged with this
        // task's id; hard-deleting the parent left that successor behind as a
        // phantom future task with a dangling reference — the user deletes
        // their recurring task and a copy keeps appearing on the due date.
        if (pendingIds.length > 0) {
          await Task.deleteMany({ _id: { $in: pendingIds } });
        }
        await task.deleteOne();
        return handleRes(res, 200, true, "Task permanently deleted");
      }
      // Default: move to trash (recoverable) instead of hard-deleting.
      const now = new Date();
      task.trashed = true;
      task.trashedAt = now;
      task.updatedAt = now;
      await task.save();
      const trashedTasks = [mapTask(task)];
      if (series && pendingIds.length > 0) {
        // Trash the chain's upcoming occurrences too, so deleting a completed
        // occurrence no longer leaves the next one scheduled as if the series
        // were still running. The client uses this list to populate Trash and
        // to record one multi-row undo.
        await Task.updateMany(
          { _id: { $in: pendingIds } },
          { $set: { trashed: true, trashedAt: now, updatedAt: now } }
        );
        const moved = await Task.find({ _id: { $in: pendingIds } });
        trashedTasks.push(...moved.map(mapTask));
      }
      return handleRes(
        res,
        200,
        true,
        series ? "Task series moved to trash" : "Task moved to trash",
        { trashedTasks }
      );
    }

    default:
      return handleRes(res, 405, false, "Method not allowed");
  }
});

export default taskHandler;
