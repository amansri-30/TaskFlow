import {
  differenceInCalendarDays,
  isWeekend,
  startOfDay,
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

/**
 * The due date as a Date, or null when it is missing or unparseable. The two
 * views and the buckets must agree on this: a NaN date is *not* a date, so it
 * belongs to "No due date" rather than being silently dropped from the list.
 */
export const dueDateOf = (t: Pick<Task, "scheduledAt">): Date | null => {
  if (!t.scheduledAt) return null;
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
  // A weekend day inside the coming week reads better as its own group than as
  // an anonymous Wednesday, but a weekend far out stays in Later — otherwise
  // grouping would scatter a distant Sat/Sun above every nearer weekday.
  if (isWeekend(due) && diff <= NEXT_7_DAYS_LAST_INDEX) return "weekend";
  if (diff <= NEXT_7_DAYS_LAST_INDEX) return "week";
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
