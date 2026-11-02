import type { Task } from "@/types";
import { csvTimestamp } from "./csv";
import { recurrenceLabel } from "./recurrence";

/**
 * iCalendar (RFC 5545) export.
 *
 * The point of this file is the one thing a JSON or CSV export cannot do:
 * hand the tasks to a calendar application as things that exist on a timeline.
 * Every dated task becomes a VEVENT, its reminder becomes a VALARM, and its
 * repeat cadence becomes an RRULE, so "pay rent every month" shows up as a
 * monthly appointment instead of a row in a spreadsheet.
 *
 * The format is old and unforgiving. Three details break naive generators:
 *
 *   1. TEXT values escape `\`, `;`, `,` and newlines. Getting this wrong turns
 *      a task called "Buy milk, eggs" into two values and corrupts the event.
 *      Note that the *property* separator `:` must not be escaped -- only the
 *      value is escaped, so an escaped colon there would be literal text.
 *   2. Content lines are limited to 75 octets and must be folded with CRLF +
 *      a leading space. Octets, not characters: slicing a JS string by length
 *      splits a multibyte sequence (or a surrogate pair) and the resulting
 *      bytes are not valid UTF-8, which some clients reject outright.
 *   3. DATE-TIME values are UTC. A "floating" local time is legal but lands in
 *      the wrong hour for every reader in another timezone, and the app already
 *      stores instants, so UTC round-trips them exactly.
 */

/** A content line may be at most 75 octets, excluding the trailing CRLF. */
const MAX_LINE_OCTETS = 75;

/** Tasks carry a due date, not a duration; an appointment needs an end. */
const TASK_DURATION_MS = 30 * 60 * 1000;

const encoder = new TextEncoder();
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Escape a TEXT value. Order matters: backslashes are doubled first, otherwise
 * the escapes inserted for `;` and `,` would themselves be escaped.
 */
export function icsEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
    // Control characters other than TAB are forbidden in TEXT; a stray NUL
    // from a paste is enough for a strict parser to discard the whole file.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * `YYYYMMDDTHHMMSSZ` in UTC, or null when the input is not a usable instant.
 * Returns null rather than an empty string so callers can tell "no date" from
 * "invalid date" and skip the task instead of emitting a broken property.
 */
export function icsTimestamp(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Fold one logical content line to the 75-octet limit.
 *
 * Continuation lines carry a leading space, so they hold one octet less of
 * payload. Iteration is by code point (`for..of`), never by UTF-16 index, so a
 * surrogate pair or a three-byte character is moved whole and the output stays
 * valid UTF-8.
 */
export function icsFold(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;

  const segments: string[] = [];
  let current = "";
  let octets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > limit) {
      segments.push(current);
      current = "";
      octets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  if (current) segments.push(current);
  return segments.join("\r\n ");
}

/** A `NAME:escaped-value` line, folded. */
function textLine(name: string, value: string): string {
  return icsFold(`${name}:${icsEscape(value)}`);
}

/** A line whose value already has its own grammar (RRULE, dates) -- no escaping. */
function rawLine(name: string, value: string): string {
  return icsFold(`${name}:${value}`);
}

/**
 * An RFC 5545 DURATION between two instants, used for the alarm trigger.
 *
 * Absolute (`TRIGGER;VALUE=DATE-TIME:...`) triggers are legal but poorly
 * supported: Google Calendar drops them on import. A relative offset is
 * computed from the event start by every client, so it is the portable form.
 * The offset may be positive -- a reminder set after the due time is valid --
 * and `PT0S` is the canonical zero.
 */
export function icsTriggerDuration(alarmMs: number, startMs: number): string {
  const total = Math.abs(Math.round((alarmMs - startMs) / 1000));
  const sign = alarmMs < startMs ? "-" : "";
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  let value = "P";
  if (days > 0) value += `${days}D`;
  let time = "";
  if (hours > 0) time += `${hours}H`;
  if (minutes > 0) time += `${minutes}M`;
  if (seconds > 0) time += `${seconds}S`;
  if (time) value += `T${time}`;
  // No component at all is the exact start; bare "P" is not a valid duration.
  return `${sign}${value === "P" ? "PT0S" : value}`;
}

/**
 * RFC 5545 PRIORITY: 1 is highest, 9 lowest, 0 means "not specified". TaskFlow's
 * three levels map onto the ends and the middle rather than 1/2/3, because the
 * value is only meaningful relative to other events in the same calendar.
 */
function icsPriority(task: Task): string | null {
  if (task.priority === "high") return "1";
  if (task.priority === "medium") return "5";
  if (task.priority === "low") return "9";
  return null;
}

/**
 * The repeat rule for a task's cadence.
 *
 * Monthly is the one with a fidelity gap: the app clamps a Jan 31 task to the
 * 28th in February and back to the 31st in March, but BYMONTHDAY has no notion
 * of clamping -- a calendar will simply skip February. Reproducing the clamp
 * would require an explicit RDATE for every affected month, which is unbounded,
 * so the rule stays faithful for days 1-28 and honest about the rest.
 */
function icsRecurrence(task: Task): string | null {
  const frequency = task.recurrence;
  if (!frequency || frequency === "none") return null;

  let rule: string;
  if (frequency === "monthly") {
    const day =
      typeof task.monthlyDay === "number" && task.monthlyDay >= 1 && task.monthlyDay <= 31
        ? task.monthlyDay
        : new Date(task.scheduledAt as string).getUTCDate();
    rule = `FREQ=MONTHLY;BYMONTHDAY=${day}`;
  } else if (frequency === "weekly") {
    rule = "FREQ=WEEKLY";
  } else if (frequency === "daily") {
    rule = "FREQ=DAILY";
  } else {
    return null;
  }

  // UNTIL must be a UTC DATE-TIME when DTSTART is one, and it is inclusive in
  // the app (the last occurrence may land exactly on it), which is also how
  // RRULE treats it here.
  const until = icsTimestamp(task.repeatUntil);
  return until ? `${rule};UNTIL=${until}` : rule;
}

/** Human-readable body of the event, one item per line. */
function icsDescription(task: Task): string {
  const parts: string[] = [];
  if (task.description?.trim()) parts.push(task.description.trim());
  if (task.notes?.trim()) parts.push(`Notes: ${task.notes.trim()}`);

  const subtasks = task.subtasks || [];
  if (subtasks.length > 0) {
    const done = subtasks.filter((s) => s.completed).length;
    parts.push(`Subtasks (${done}/${subtasks.length}):`);
    // The text is a snapshot, not a live checklist -- a calendar client cannot
    // write back -- but seeing the steps next to the appointment is the reason
    // to export at all.
    for (const subtask of subtasks) {
      parts.push(`${subtask.completed ? "[x]" : "[ ]"} ${subtask.text}`);
    }
  }

  if (task.list) parts.push(`List: ${task.list}`);
  if (task.tags && task.tags.length > 0) {
    parts.push(`Tags: ${task.tags.map((tag) => `#${tag}`).join(" ")}`);
  }

  const repeat = recurrenceLabel(task.recurrence);
  if (repeat) {
    // Local date, matching the CSV export's "Repeat" cell, so the two files
    // never disagree about the day a series ends.
    const until = csvTimestamp(task.repeatUntil).slice(0, 10);
    parts.push(until ? `Repeats: ${repeat} until ${until}` : `Repeats: ${repeat}`);
  }

  return parts.join("\n");
}

export type IcsExport = {
  contents: string;
  /** VEVENTs written. */
  eventCount: number;
  /** Rows a calendar cannot place: no due date, or an unparseable one. */
  skipped: number;
};

export type IcsOptions = {
  /** Shown as the calendar's name in clients that display one. */
  calendarName?: string;
  /** Export instant stamped on every event; injectable for tests. */
  now?: Date;
};

/**
 * One VEVENT per dated task, in the order given -- the caller passes the rows
 * on screen, so the calendar matches the visible list.
 *
 * Completed tasks are exported rather than dropped: the calendar is also a
 * record of what happened, and silence about a finished task is worse than an
 * event marked transparent (it does not block time). Undated tasks are counted
 * and reported by the caller instead of being invented onto today.
 */
export function tasksToIcs(tasks: Task[], options: IcsOptions = {}): IcsExport {
  const stamp =
    icsTimestamp((options.now ?? new Date()).toISOString()) ?? "19700101T000000Z";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TaskFlow//TaskFlow Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    textLine("X-WR-CALNAME", options.calendarName || "TaskFlow"),
  ];

  let eventCount = 0;
  let skipped = 0;

  for (const task of tasks) {
    const start = icsTimestamp(task.scheduledAt);
    const startMs = task.scheduledAt ? new Date(task.scheduledAt).getTime() : NaN;
    const uidSeed = task.id || task._id;
    if (!start || !uidSeed || isNaN(startMs)) {
      skipped += 1;
      continue;
    }

    const end = icsTimestamp(new Date(startMs + TASK_DURATION_MS).toISOString());
    const summary = task.title?.trim() || "Untitled task";
    // UIDs may be any non-empty string, but keeping them to a safe subset means
    // an imported id with whitespace cannot produce a line that needs folding.
    const uid = `${String(uidSeed).replace(/[^A-Za-z0-9_.@-]/g, "-")}@taskflow`;

    lines.push("BEGIN:VEVENT");
    lines.push(rawLine("UID", uid));
    lines.push(rawLine("DTSTAMP", stamp));
    lines.push(rawLine("DTSTART", start));
    if (end) lines.push(rawLine("DTEND", end));
    lines.push(textLine("SUMMARY", summary));

    const description = icsDescription(task);
    if (description) lines.push(textLine("DESCRIPTION", description));

    const categories = [task.list, ...(task.tags || [])]
      .filter((value): value is string => Boolean(value && String(value).trim()))
      .map((value) => icsEscape(value))
      .join(",");
    if (categories) lines.push(rawLine("CATEGORIES", categories));

    const priority = icsPriority(task);
    if (priority) lines.push(rawLine("PRIORITY", priority));

    if (task.completed) {
      // A finished task should not make the user look busy.
      lines.push("TRANSP:TRANSPARENT");
      lines.push(rawLine("X-TASKFLOW-COMPLETED", "TRUE"));
      if (task.completedAt) {
        const completedAt = icsTimestamp(task.completedAt);
        // `COMPLETED` belongs to VTODO, not VEVENT -- a strict validator would
        // reject it here, so the instant travels as an extension property.
        if (completedAt) lines.push(rawLine("X-TASKFLOW-COMPLETED-AT", completedAt));
      }
    }

    const rule = icsRecurrence(task);
    if (rule) lines.push(rawLine("RRULE", rule));

    if (task.updatedAt) {
      const modified = icsTimestamp(task.updatedAt);
      if (modified) lines.push(rawLine("LAST-MODIFIED", modified));
    }

    const reminderMs = task.remindAt ? new Date(task.remindAt).getTime() : NaN;
    if (!isNaN(reminderMs)) {
      // A DISPLAY alarm needs an ACTION, a TRIGGER and a DESCRIPTION. The body
      // is the task title so the notification is recognisable when it fires
      // without the event in view.
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(textLine("DESCRIPTION", `${summary} (TaskFlow)`));
      lines.push(
        rawLine("TRIGGER", icsTriggerDuration(reminderMs, startMs))
      );
      lines.push("END:VALARM");
    }

    lines.push("END:VEVENT");
    eventCount += 1;
  }

  lines.push("END:VCALENDAR");

  // RFC 5545 asks for CRLF between content lines and after the final one.
  return { contents: `${lines.join("\r\n")}\r\n`, eventCount, skipped };
}
