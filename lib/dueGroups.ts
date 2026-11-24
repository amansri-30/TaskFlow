import {
  addDays,
  differenceInCalendarDays,
  startOfDay,
  startOfWeek,
} from "date-fns";
import type { Task } from "@/types";

/**
 * Date buckets for the grouped list. Presentation only — `scheduledAt` is
 * already persisted and shipped by the API, so grouping needs no model, API or
 * migration, and nothing about a task's stored shape changes.
 */
export type DueBucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "weekend"
  | "week"
  | "later"
  | "none";

/** Rendered order. Overdue first because it is the only actionable group. */
export const DUE_BUCKET_ORDER: DueBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "weekend",
  "week",
  "later",
  "none",
];

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  weekend: "This weekend",
  week: "Later this week",
  later: "Later",
  none: "No due date",
};

/**
 * "Next 7 days" is today plus the following six days, i.e. 7 days in total.
 * `addDays(today, 7)` would span 8 calendar days and quietly contradict the
 * label, so the upper bound is inclusive of index 6.
 */
export const NEXT_7_DAYS = 7;
const NEXT_7_DAYS_LAST_INDEX = NEXT_7_DAYS - 1;
const SATURDAY_OFFSET = 5;

/**
 * The due date as a Date, or null when it is missing or unparseable. The two
 * views and the buckets must agree on this: a NaN date is *not* a date, so it
 * belongs to "No due date" rather than being silently dropped from the list.
 */
export const dueDateOf = (t: Pick<Task, "scheduledAt">): Date | null => {
  if (!t.scheduledAt) return null;
  // `new Date("2026-11-23")` is UTC midnight, which is still Nov 22 in the
  // Americas. Exports and imports use date-only values for tasks that mean a
  // local calendar day, so parse that shape in local time before bucketing.
  if (typeof t.scheduledAt === "string") {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.scheduledAt);
    if (dateOnly) {
      const d = new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const d = new Date(t.scheduledAt);
  return isNaN(d.getTime()) ? null : d;
};

export const hasDueDate = (t: Pick<Task, "scheduledAt">): boolean =>
  dueDateOf(t) !== null;

/** True when the task falls inside today .. today+6. Overdue is excluded. */
export const isDueWithinDays = (
  t: Pick<Task, "scheduledAt">,
  now: Date,
  days: number = NEXT_7_DAYS
): boolean => {
  const due = dueDateOf(t);
  if (!due) return false;
  const diff = differenceInCalendarDays(
    startOfDay(due),
    startOfDay(now)
  );
  return diff >= 0 && diff <= days - 1;
};

export const dueBucket = (
  t: Pick<Task, "scheduledAt">,
  now: Date
): DueBucket => {
  const due = dueDateOf(t);
  if (!due) return "none";
  const diff = differenceInCalendarDays(
    startOfDay(due),
    startOfDay(now)
  );
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  // "This weekend" is Saturday/Sunday of the current Monday-start week, not
  // any weekend inside the next seven days. On Sunday, next Saturday is seven
  // days away and belongs in Later, not above the current week's work.
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekendStart = addDays(weekStart, SATURDAY_OFFSET);
  const weekendEnd = addDays(weekendStart, 2);
  const dueDay = startOfDay(due);
  if (dueDay >= weekendStart && dueDay < weekendEnd) return "weekend";
  // "Later this week" stops at Sunday of the current Monday-start week. Using
  // the rolling seven-day window here put next Monday under a heading that
  // plainly says this week.
  const endOfThisWeek = addDays(weekStart, NEXT_7_DAYS_LAST_INDEX);
  if (dueDay <= endOfThisWeek) return "week";
  return "later";
};

/** Smart-view labels for the list heading; the chip row is deliberately not widened. */
export const SMART_FILTER_LABELS: Record<string, string> = {
  next7: "Next 7 days",
  nodate: "No due date",
};

export type DueGroup = { bucket: DueBucket | "pinned"; tasks: Task[] };

/**
 * Bucket the incomplete tasks for display. Pinned tasks are pulled into their
 * own leading group and excluded from the date buckets so nothing renders
 * twice; inside every remaining group the existing sort (which already hoists
 * pins) is preserved.
 */
export const groupTasksByDue = (tasks: Task[], now: Date): DueGroup[] => {
  const pinned: Task[] = [];
  const rest: Task[] = [];
  for (const t of tasks) {
    (t.pinned ? pinned : rest).push(t);
  }

  const buckets = new Map<DueBucket, Task[]>();
  for (const t of rest) {
    const key = dueBucket(t, now);
    const list = buckets.get(key);
    if (list) list.push(t);
    else buckets.set(key, [t]);
  }

  const groups: DueGroup[] = [];
  // Empty buckets are dropped entirely rather than rendered as "Overdue (0)".
  for (const key of DUE_BUCKET_ORDER) {
    const list = buckets.get(key);
    if (list && list.length > 0) groups.push({ bucket: key, tasks: list });
  }
  if (pinned.length > 0) groups.unshift({ bucket: "pinned", tasks: pinned });
  return groups;
};

export const groupLabel = (bucket: DueBucket | "pinned"): string =>
  bucket === "pinned" ? "Pinned" : DUE_BUCKET_LABELS[bucket];
