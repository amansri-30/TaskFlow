export type ReminderPresetId =
  | "none"
  | "at-time"
  | "10m"
  | "1h"
  | "3h"
  | "tomorrow"
  | "custom";

export type ReminderPreset = {
  id: ReminderPresetId;
  label: string;
  minutes: number | null;
};

export const REMINDER_PRESETS: ReminderPreset[] = [
  { id: "none", label: "No reminder", minutes: null },
  { id: "at-time", label: "At time of task", minutes: null },
  { id: "10m", label: "10 minutes before", minutes: 10 },
  { id: "1h", label: "1 hour before", minutes: 60 },
  { id: "3h", label: "3 hours before", minutes: 180 },
  { id: "tomorrow", label: "Tomorrow morning", minutes: null },
  { id: "custom", label: "Pick date & time", minutes: null },
];

/**
 * Turn a preset plus a chosen date into an absolute instant.
 * Returns null when the reminder should be cleared.
 */
export function resolveReminderAt(
  preset: ReminderPresetId | string,
  baseIso?: string | null,
  customIso?: string | null
): Date | null {
  if (!preset || preset === "none") return null;

  if (preset === "custom") {
    if (!customIso) return null;
    const custom = new Date(customIso);
    return isNaN(custom.getTime()) ? null : custom;
  }

  const base = baseIso ? new Date(baseIso) : new Date();
  if (isNaN(base.getTime())) return null;

  if (preset === "tomorrow") {
    const next = new Date(base);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    // If "tomorrow 9am" is already in the past, roll it a day forward so a
    // reminder is never silently created for a moment that has passed.
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next;
  }

  const minutes = REMINDER_PRESETS.find((p) => p.id === preset)?.minutes;
  if (minutes == null) return base;
  return new Date(base.getTime() - minutes * 60 * 1000);
}

/** Human label for a reminder instant, e.g. "in 25 min" or "2 days ago". */
export function reminderLabel(remindAt?: string | null): string {
  if (!remindAt) return "";
  const when = new Date(remindAt);
  if (isNaN(when.getTime())) return "";

  const diffMs = when.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);

  let span: string;
  if (minutes < 1) span = "now";
  else if (minutes < 60) span = `${minutes} min`;
  else if (minutes < 60 * 24) {
    const hours = Math.round(minutes / 60);
    span = `${hours} hour${hours === 1 ? "" : "s"}`;
  } else {
    const days = Math.round(minutes / (60 * 24));
    span = `${days} day${days === 1 ? "" : "s"}`;
  }

  if (span === "now") return "now";
  return diffMs > 0 ? `in ${span}` : `${span} ago`;
}

/** A reminder is due once it has passed and has not been acknowledged. */
export function isReminderDue(
  remindAt?: string | null,
  remindedAt?: string | null
): boolean {
  if (!remindAt) return false;
  if (remindedAt) return false;
  const when = new Date(remindAt);
  if (isNaN(when.getTime())) return false;
  return when.getTime() <= Date.now();
}
