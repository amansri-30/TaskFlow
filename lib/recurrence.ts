export type Recurrence = "none" | "daily" | "weekly" | "monthly";

export const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export function isRecurrence(value: unknown): value is Recurrence {
  return (
    value === "none" ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly"
  );
}

export function recurrenceLabel(value: Recurrence | null | undefined): string {
  if (!value || value === "none") return "";
  return RECURRENCE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function nextOccurrenceDate(
  from: Date,
  recurrence: Recurrence,
  monthlyDay?: number | null
): Date | null {
  if (recurrence === "none") return null;

  const next = new Date(from);
  if (!isFinite(next.getTime())) return null;

  if (recurrence === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }

  if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }

  // monthly — keep the day-of-month, clamping to the last day of shorter
  // months. The anchor day is fixed at task creation (monthlyDay), so a
  // Jan 31 task repeats on Feb 28, Mar 31, Apr 30 — without drifting to the
  // 28th permanently.
  const anchorDay = monthlyDay ?? from.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + 1);
  const lastDay = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0
  ).getDate();
  next.setDate(Math.min(anchorDay, lastDay));
  return next;
}