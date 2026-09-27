import { addDays, startOfDay, startOfWeek, addWeeks, addMonths } from "date-fns";

export type DeferPresetId =
  | "tomorrow"
  | "weekend"
  | "next-week"
  | "two-weeks"
  | "one-month"
  | "none";

export type DeferPreset = {
  id: DeferPresetId;
  label: string;
};

export const DEFER_PRESETS: DeferPreset[] = [
  { id: "tomorrow", label: "Tomorrow" },
  { id: "weekend", label: "This weekend" },
  { id: "next-week", label: "Next week" },
  { id: "two-weeks", label: "In two weeks" },
  { id: "one-month", label: "In one month" },
  { id: "none", label: "No due date" },
];

/**
 * Resolve a defer preset to an instant, or null when the task should lose its
 * due date.
 *
 * Two rules matter here:
 *  - The result is never in the past, so an overdued task can always be pushed
 *    forward instead of silently staying overdue.
 *  - The original time-of-day is preserved, because a lead-time reminder
 *    ("1 hour before") is anchored to the due time, and snapping to midnight
 *    would silently shift it.
 *
 * Dates are built with `new Date(y, m, d)` rather than `new Date("YYYY-MM-DD")`,
 * which parses as UTC and slips a day in negative UTC offsets.
 */
export function resolveDeferPreset(
  preset: DeferPresetId | string,
  currentDue?: string | Date | null
): Date | null {
  if (preset === "none") return null;

  const current = currentDue
    ? currentDue instanceof Date
      ? currentDue
      : new Date(currentDue)
    : null;
  const base = current && !isNaN(current.getTime()) ? current : new Date();
  const keepTime = (date: Date) => {
    date.setHours(base.getHours(), base.getMinutes(), 0, 0);
    return date;
  };
  const today = startOfDay(new Date());
  // Never hand back a moment that has already passed: nudge a same-day
  // resolution to the next day rather than locking the user out of a preset.
  const guard = (date: Date) => {
    if (date.getTime() <= new Date().getTime()) {
      const bumped = new Date(date);
      bumped.setDate(bumped.getDate() + 1);
      return bumped;
    }
    return date;
  };

  switch (preset) {
    case "tomorrow":
      return guard(keepTime(addDays(base, 1)));
    case "weekend": {
      // Saturday of the current week, but never a weekend day already gone.
      const saturday = addDays(startOfWeek(today, { weekStartsOn: 1 }), 5);
      const target = saturday.getTime() < today.getTime() ? addWeeks(saturday, 1) : saturday;
      return guard(keepTime(target));
    }
    case "next-week": {
      // The Monday of next week — the most common "push it a week" target.
      const monday = addWeeks(startOfWeek(today, { weekStartsOn: 1 }), 7);
      return guard(keepTime(monday));
    }
    case "two-weeks":
      return guard(keepTime(addWeeks(base, 2)));
    case "one-month":
      // date-fns clamps Jan 31 + 1 month to Feb 28/29 rather than overflowing
      // into March, which is the behavior people expect from "in one month".
      return guard(keepTime(addMonths(base, 1)));
    default:
      return null;
  }
}

/** Compact label for a due date, used in menus and toasts. */
export function deferLabel(iso?: string | Date | null): string {
  if (!iso) return "No due date";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "No due date";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
