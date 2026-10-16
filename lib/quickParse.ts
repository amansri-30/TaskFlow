import { addDays, startOfDay } from "date-fns";

export type QuickPriority = "low" | "medium" | "high";

export type QuickParseResult = {
  /** The title with every recognised token stripped out. Never empty. */
  title: string;
  /** The resolved due date, or null when the input named no day or time. */
  dueDate: Date | null;
  /** Raw tags typed as `#tag`, in the order they appeared. */
  tags: string[];
  priority: QuickPriority | null;
};

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const PRIORITY_WORDS: Record<string, QuickPriority> = {
  l: "low",
  low: "low",
  m: "medium",
  med: "medium",
  medium: "medium",
  h: "high",
  high: "high",
};

/** Default hour for a day that was named without a specific time. */
const DAY_START_HOUR = 9;

function parseTimeToken(
  token: string
): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(token);
  if (!match) return null;
  const hasMinutes = Boolean(match[2]);
  const meridiem = match[3];
  // A bare number ("3", "1") is far more likely part of a title than a time,
  // so only treat it as one when it carries a colon or an am/pm suffix.
  if (!meridiem && !hasMinutes) return null;
  let hours = Number(match[1]);
  const minutes = hasMinutes ? Number(match[2]) : 0;
  if (meridiem === "pm" && hours !== 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Turn a one-line "quick add" string into structured task fields, matching the
 * grammar advertised in the capture box: `#tag`, `!high`, `today` / `tomorrow`
 * / a weekday name / `next week`, and an optional time such as `6pm` or `18:00`.
 * Everything that is not recognised is left in the title, so a stray word is
 * never silently swallowed.
 */
export function parseQuickAdd(
  input: string,
  now: Date = new Date()
): QuickParseResult {
  const tags: string[] = [];
  let priority: QuickPriority | null = null;
  let dueDate: Date | null = null;
  let time: { hours: number; minutes: number } | null = null;
  const kept: string[] = [];

  const words = input.split(/\s+/).filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase();

    if (lower.startsWith("#") && lower.length > 1) {
      tags.push(word.slice(1));
      continue;
    }

    if (lower.startsWith("!") && lower.length > 1) {
      const mapped = PRIORITY_WORDS[lower.slice(1)];
      if (mapped) {
        priority = mapped;
        continue;
      }
    }

    if (lower === "today" || lower === "tonight") {
      dueDate = startOfDay(now);
      if (lower === "tonight") time = { hours: 20, minutes: 0 };
      continue;
    }

    if (lower === "tomorrow") {
      dueDate = addDays(startOfDay(now), 1);
      continue;
    }

    if (lower === "next" && words[i + 1]?.toLowerCase() === "week") {
      dueDate = addDays(startOfDay(now), 7);
      i += 1;
      continue;
    }

    const weekday = WEEKDAYS.indexOf(lower);
    if (weekday !== -1) {
      // The next occurrence of that weekday, never today.
      const delta = (weekday - startOfDay(now).getDay() + 7) % 7 || 7;
      dueDate = addDays(startOfDay(now), delta);
      continue;
    }

    const parsedTime = parseTimeToken(lower);
    if (parsedTime) {
      time = parsedTime;
      continue;
    }

    kept.push(word);
  }

  if (dueDate) {
    const resolved = new Date(dueDate);
    if (time) {
      resolved.setHours(time.hours, time.minutes, 0, 0);
    } else {
      resolved.setHours(DAY_START_HOUR, 0, 0, 0);
    }
    dueDate = resolved;
  } else if (time) {
    // A time with no day means the next time that clock reading comes around.
    const candidate = startOfDay(now);
    candidate.setHours(time.hours, time.minutes, 0, 0);
    dueDate =
      candidate.getTime() > now.getTime() ? candidate : addDays(candidate, 1);
  }

  // "today" resolved to 09:00 can already be in the past; never hand back a
  // moment that has elapsed or the new task would be born overdue.
  if (dueDate && dueDate.getTime() < now.getTime()) {
    dueDate = new Date(now.getTime() + 60_000);
  }

  const title = kept.join(" ").trim();
  return { title: title || input.trim(), dueDate, tags, priority };
}
