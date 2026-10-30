import { addDays, addMonths, addWeeks, startOfDay, startOfWeek } from "date-fns";
import type { Recurrence } from "./recurrence";

export type QuickPriority = "low" | "medium" | "high";

export type QuickParseResult = {
  /** The title with every recognised token stripped out. Never empty. */
  title: string;
  /** The resolved due date, or null when the input named no day or time. */
  dueDate: Date | null;
  /**
   * List typed as `list:<name>`, lowercased to match the sidebar's list
   * vocabulary (static lists and custom lists are both stored lowercase).
   */
  list: string | null;
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
 * Saturday of the current week, or next Saturday once today's has passed.
 *
 * "This weekend" typed on a Sunday must mean the coming weekend, not the one
 * that ended yesterday, and typed on a Saturday morning it means today. Shared
 * by the quick-add grammar and the sidebar's defer preset so the two cannot
 * disagree about which Saturday "the weekend" is.
 */
export function upcomingSaturday(now: Date = new Date()): Date {
  const today = startOfDay(now);
  const saturday = addDays(startOfWeek(today, { weekStartsOn: 1 }), 5);
  return saturday.getTime() < today.getTime() ? addDays(saturday, 7) : saturday;
}

/**
 * Turn a one-line "quick add" string into structured task fields, matching the
 * grammar advertised in the capture box: `#tag`, `list:<name>`, `!high`,
 * `today` / `tomorrow` / `weekend` / a weekday name / `next week` / `next
 * month` / `in 3 days`, an optional time such as `6pm`, `18:00` or `at 6pm`, a
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
  let list: string | null = null;
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
    const nextWord = words[i + 1]?.toLowerCase();

    if (lower.startsWith("#") && lower.length > 1) {
      tags.push(word.slice(1));
      continue;
    }

    // `list:<name>` targets a list without first navigating into it. Lowercased
    // for the same reason custom lists are: the sidebar filter compares names by
    // character, so `list:Work` and a stored "work" would otherwise be two
    // different lists that render identically.
    //
    // A quoted name may contain spaces (`list:"home office"`). Quoting is only
    // honoured when the closing quote is actually present further along the
    // line; otherwise a stray quote would swallow the rest of the title.
    if (lower.startsWith("list:") && lower.length > "list:".length) {
      const rawValue = word.slice("list:".length);
      const quote = rawValue[0];
      let value = rawValue;
      if (
        (quote === '"' || quote === "'") &&
        !(rawValue.length > 1 && rawValue.endsWith(quote))
      ) {
        for (let j = i + 1; j < words.length; j++) {
          if (words[j].endsWith(quote)) {
            value = words.slice(i, j + 1).join(" ").slice("list:".length);
            i = j;
            break;
          }
        }
      }
      value = value
        .replace(/^["']|["']$/g, "")
        .trim()
        .toLowerCase()
        .slice(0, 50);
      if (value) {
        list = value;
        continue;
      }
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

    // "This weekend" / "next weekend" / "weekend" resolve to the coming
    // Saturday. Checked before the generic weekday branch because neither word
    // is a weekday name.
    if (
      lower === "weekend" ||
      ((lower === "this" || lower === "next") && nextWord === "weekend")
    ) {
      dueDate = upcomingSaturday(now);
      if (lower === "this" || lower === "next") i += 1;
      continue;
    }

    // Relative offsets: `in 3 days`, `in 2 weeks`, `in a month`. The unit must
    // be one of the three calendar units the parser understands, so "in 5
    // minutes" or "in the garage" are left alone rather than half-consumed.
    if (lower === "in") {
      const amount =
        nextWord === "a" || nextWord === "an"
          ? 1
          : /^\d{1,3}$/.test(nextWord || "")
          ? Number(nextWord)
          : null;
      const unit = words[i + 2]?.toLowerCase().replace(/s$/, "");
      if (amount && amount > 0 && (unit === "day" || unit === "week" || unit === "month")) {
        const today = startOfDay(now);
        dueDate =
          unit === "day"
            ? addDays(today, amount)
            : unit === "week"
            ? addWeeks(today, amount)
            : addMonths(today, amount);
        i += 2;
        continue;
      }
    }

    // `next <weekday>` and `next month`. The weekday really is the next
    // occurrence (never today), and consuming the "next" is what keeps it out
    // of the title: it used to be stripped for "next week" alone, so "next
    // monday" captured the title "next" instead of the task name.
    if (lower === "next" && nextWord === "week") {
      dueDate = addDays(startOfDay(now), 7);
      i += 1;
      continue;
    }
    if (lower === "next" && nextWord === "month") {
      dueDate = addMonths(startOfDay(now), 1);
      i += 1;
      continue;
    }
    if (lower === "next" && nextWord && WEEKDAYS.indexOf(nextWord) !== -1) {
      const targetWeekday = WEEKDAYS.indexOf(nextWord);
      const delta = (targetWeekday - startOfDay(now).getDay() + 7) % 7 || 7;
      dueDate = addDays(startOfDay(now), delta);
      i += 1;
      continue;
    }

    // Repeat cadence. `every` only consumes the next word when it forms a known
    // phrase, so "every other week" leaves "every other week" in the title
    // rather than being half-eaten into a weekly repeat.
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

    // `at 6pm` / `at 18:00`: the preposition is part of how people say a due
    // time, so it is stripped along with the clock reading instead of being
    // left behind in the title ("call mom at").
    if (lower === "at" && nextWord) {
      const parsedTime = parseTimeToken(nextWord);
      if (parsedTime) {
        time = parsedTime;
        i += 1;
        continue;
      }
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
  return { title: title || input.trim(), dueDate, list, tags, priority, recurrence, repeatUntil };
}
