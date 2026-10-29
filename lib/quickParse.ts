import { addDays, startOfDay } from "date-fns";
import type { Recurrence } from "./recurrence";

export type QuickPriority = "low" | "medium" | "high";

export type QuickParseResult = {
  /** The title with every recognised token stripped out. Never empty. */
  title: string;
  /** The resolved due date, or null when the input named no day or time. */
  dueDate: Date | null;
  /** Raw tags typed as `#tag`, in the order they appeared. */
  tags: string[];
  priority: QuickPriority | null;
  /** Repeat cadence named with `daily` / `every day` / `weekly` / `monthly`. */
  recurrence: Recurrence | null;
  /**
   * End of the repeat series from `until <day>`, set to the end of that local
   * day. Never non-null while `recurrence` is null — without a cadence the
   * `until` phrase stays in the title instead of being stripped.
   */
  repeatUntil: Date | null;
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
 * / a weekday name / `next week`, an optional time such as `6pm` or `18:00`, a
 * repeat cadence (`daily`, `every day`, `weekly`, `every week`, `monthly`,
 * `every month`), and a repeat end date as `until <day>` (a weekday, `today`,
 * `tomorrow`, `next week`, or an explicit `YYYY-MM-DD`). Everything that is not
 * recognised is left in the title, so a stray word is never silently swallowed.
 */
export function parseQuickAdd(
  input: string,
  now: Date = new Date()
): QuickParseResult {
  const tags: string[] = [];
  let priority: QuickPriority | null = null;
  let dueDate: Date | null = null;
  let recurrence: Recurrence | null = null;
  let repeatUntil: Date | null = null;
  // The raw words behind `until <day>`, kept so the phrase can be put back into
  // the title when no cadence is present (see the restore step before `title`).
  let untilWords: string[] = [];
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

    // Repeat cadence. `every` only consumes the next word when it forms a known
    // phrase, so "every other week" leaves "every other week" in the title
    // rather than being half-eaten into a weekly repeat.
    const nextWord = words[i + 1]?.toLowerCase();
    if (lower === "daily" || lower === "everyday") {
      recurrence = "daily";
      continue;
    }
    if (lower === "weekly") {
      recurrence = "weekly";
      continue;
    }
    if (lower === "monthly") {
      recurrence = "monthly";
      continue;
    }
    if (lower === "every" && nextWord === "day") {
      recurrence = "daily";
      i += 1;
      continue;
    }
    if (lower === "every" && nextWord === "week") {
      recurrence = "weekly";
      i += 1;
      continue;
    }
    if (lower === "every" && nextWord === "month") {
      recurrence = "monthly";
      i += 1;
      continue;
    }

    // `until <day>` bounds the series. Only a day-like target is accepted, so
    // "wait until the courier calls" keeps every word in the title. The date is
    // resolved to the end of that local day: "until friday" must still allow an
    // occurrence that falls on the Friday itself.
    if (lower === "until") {
      const targetLower = words[i + 1]?.toLowerCase();
      let day: Date | null = null;
      let span = 1;
      const iso = targetLower
        ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(targetLower)
        : null;
      if (iso) {
        const [year, month, date] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
        const candidate = new Date(year, month - 1, date);
        // Reject rollovers such as 2026-13-40, which Date would happily accept
        // as a day in the following year.
        if (
          candidate.getFullYear() === year &&
          candidate.getMonth() === month - 1 &&
          candidate.getDate() === date
        ) {
          day = candidate;
        }
      } else if (targetLower === "today") {
        day = startOfDay(now);
      } else if (targetLower === "tomorrow") {
        day = addDays(startOfDay(now), 1);
      } else if (targetLower === "next" && words[i + 2]?.toLowerCase() === "week") {
        day = addDays(startOfDay(now), 7);
        span = 2;
      } else if (targetLower && WEEKDAYS.indexOf(targetLower) !== -1) {
        const targetWeekday = WEEKDAYS.indexOf(targetLower);
        const delta = (targetWeekday - startOfDay(now).getDay() + 7) % 7 || 7;
        day = addDays(startOfDay(now), delta);
      }

      if (day) {
        // `span` counts the words AFTER "until" that make up the target
        // ("friday" = 1, "next week" = 2), so the phrase itself is span + 1
        // words long. Slicing only `span` words kept "until" and dropped the
        // day: without a cadence that left a title reading "buy milk until"
        // and the named day silently vanished.
        const phrase = words.slice(i, i + span + 1);
        if (repeatUntil) {
          // A second `until` is ambiguous; keep it verbatim rather than letting
          // one silently overwrite the other.
          kept.push(...phrase);
        } else {
          const end = new Date(day);
          end.setHours(23, 59, 59, 999);
          repeatUntil = end;
          untilWords = phrase;
        }
        i += span;
        continue;
      }
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

  // An end date only means something for a repeating task. Without a cadence
  // the `until <day>` phrase goes back into the title (normally at the end,
  // where it was typed) rather than being swallowed and discarded.
  if (repeatUntil && !recurrence) {
    kept.push(...untilWords);
    repeatUntil = null;
  }

  const title = kept.join(" ").trim();
  return { title: title || input.trim(), dueDate, tags, priority, recurrence, repeatUntil };
}
