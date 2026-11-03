import type { CsvTaskSeed } from "./csvImport";

/**
 * iCalendar (RFC 5545) import: the read side of `lib/ics.ts`.
 *
 * The exporter writes one VEVENT per dated task, so the minimum useful reader
 * has to undo three things a calendar file does to text:
 *
 *   1. Long lines are folded at 75 octets. Unfolding is not optional: a title
 *      split across two lines would otherwise import as "Buy mil" plus a
 *      stray property.
 *   2. TEXT values escape `\`, `;`, `,` and newlines. Splitting CATEGORIES on
 *      every comma without honouring `\,` turns one category into two.
 *   3. Times are UTC, floating local, or wall-clock in a TZID zone. Guessing
 *      wrong is not cosmetic here -- a reminder is an absolute instant, so a
 *      four-hour error moves the notification by four hours.
 *
 * Round-tripping TaskFlow's own export is the primary contract, so the
 * DESCRIPTION body is read back into description/notes/subtasks/list/tags/
 * repeat. Reading a file from another calendar still works because every one
 * of those markers is optional and a VEVENT without them imports from SUMMARY,
 * DTSTART, CATEGORIES and RRULE alone. VTODO blocks are accepted too, because
 * that is what task-oriented calendars export; VEVENT is what TaskFlow writes.
 */

export type IcsTaskSeed = CsvTaskSeed & {
  /** Monthly anchor day; `CsvTaskSeed` predates the field. */
  monthlyDay?: number;
};

export type IcsImportResult = {
  seeds: IcsTaskSeed[];
  /** VEVENT/VTODO blocks seen. */
  eventCount: number;
  /** Blocks dropped: cancelled, overridden instance, duplicate UID, undated. */
  skipped: number;
};

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

type IcsBlock = {
  kind: "VEVENT" | "VTODO";
  props: IcsProperty[];
  alarms: IcsProperty[][];
};

const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i;

/**
 * Join folded content lines. Continuation lines start with a space or a tab,
 * and the marker itself is not part of the value. Input line endings are
 * normalised first so the same code handles CRLF, LF and bare CR.
 */
export function unfoldIcs(text: string): string[] {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n|\r/g, "\n");
  const lines: string[] = [];
  for (const line of src.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** Index of the first `target` outside a double-quoted parameter value. */
function findUnquoted(text: string, target: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && ch === target) return i;
  }
  return -1;
}

function splitUnquoted(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
      continue;
    }
    if (!quoted && ch === separator) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

const unquote = (value: string) =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;

/** `NAME;PARAM=value:payload`, or null for a line that is not a property. */
function parseProperty(line: string): IcsProperty | null {
  const colon = findUnquoted(line, ":");
  if (colon < 0) return null;

  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = splitUnquoted(left, ";");
  const name = rawName.trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const rawParam of rawParams) {
    const eq = rawParam.indexOf("=");
    if (eq < 0) {
      const flag = rawParam.trim().toUpperCase();
      if (flag) params[flag] = "";
      continue;
    }
    const key = rawParam.slice(0, eq).trim().toUpperCase();
    if (key) params[key] = unquote(rawParam.slice(eq + 1).trim());
  }

  return { name, params, value };
}

/**
 * Undo RFC 5545 TEXT escaping. Unknown escapes are kept verbatim rather than
 * losing the backslash, because a Windows path in a description is more common
 * than a malformed escape.
 */
export function icsUnescape(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[i + 1];
    if (next === undefined) break;
    if (next === "n" || next === "N") {
      out += "\n";
      i++;
    } else if (next === "\\" || next === ";" || next === ",") {
      out += next;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Split a comma-separated TEXT list, respecting `\,`. */
function splitIcsList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      current += ch + value[i + 1];
      i++;
      continue;
    }
    if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts
    .map((part) => icsUnescape(part).trim())
    .filter(Boolean);
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The zone's offset at an instant, in milliseconds (local wall clock - UTC).
 * `Intl` is the only timezone database available in a client bundle without a
 * dependency, and it is the same database the browser uses for everything else.
 */
function zoneOffsetMs(instantMs: number, timeZone: string): number | null {
  try {
    let formatter = zoneFormatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      zoneFormatters.set(timeZone, formatter);
    }
    const parts = formatter.formatToParts(new Date(instantMs));
    const read = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    const wallClock = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour"),
      read("minute"),
      read("second")
    );
    if (isNaN(wallClock)) return null;
    return wallClock - instantMs;
  } catch {
    // Unknown zone on an engine without full ICU: fall back to local time.
    return null;
  }
}

/**
 * A wall-clock time in a named zone to an instant. Two passes settle daylight
 * saving: the first estimate may land on the other side of a transition, the
 * second uses the offset actually in force at that instant.
 */
function zonedWallClockToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date | null {
  const wallClock = Date.UTC(year, monthIndex, day, hour, minute, second);
  let guess = wallClock;
  for (let attempt = 0; attempt < 3; attempt++) {
    const offset = zoneOffsetMs(guess, timeZone);
    if (offset === null) return null;
    const next = wallClock - offset;
    if (next === guess) return new Date(next);
    guess = next;
  }
  return new Date(guess);
}

/**
 * `YYYYMMDD`, `YYYYMMDDTHHMMSS` or `YYYYMMDDTHHMMSSZ`, or null. DATE values
 * become local midnight because an all-day event has no instant of its own;
 * a floating DATE-TIME is also local, which is what every client does with it.
 */
export function parseIcsDate(
  value: string,
  params: Record<string, string> = {}
): Date | null {
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hasTime = match[4] !== undefined;
  const hour = hasTime ? Number(match[4]) : 0;
  const minute = hasTime ? Number(match[5]) : 0;
  const second = hasTime ? Number(match[6]) : 0;
  const utc = Boolean(match[7]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  ) {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Reject rollovers such as 20260231; Date normalises them silently.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  if (utc) return check;

  const tzid = params.TZID;
  if (tzid && hasTime) {
    const zoned = zonedWallClockToUtc(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
      tzid
    );
    if (zoned) return zoned;
  }

  return new Date(year, month - 1, day, hour, minute, second, 0);
}

/**
 * RRULE UNTIL is inclusive, and a DATE-form UNTIL covers the whole day. The
 * app compares `nextDue > repeatUntil`, so midnight would drop the occurrence
 * that falls on the final day.
 */
function parseIcsUntil(value: string): Date | null {
  const parsed = parseIcsDate(value);
  if (!parsed) return null;
  if (/^\d{8}$/.test(value.trim())) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
}

/**
 * RFC 5545 DURATION to milliseconds. Used for VALARM triggers, where the sign
 * carries the meaning: `-PT15M` fires fifteen minutes before the event.
 */
export function parseIcsDuration(value: string): number | null {
  const text = value.trim();
  const match =
    /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
      text
    );
  if (!match || !/[0-9]/.test(text)) return null;

  const sign = match[1] === "-" ? -1 : 1;
  const weeks = Number(match[2] || 0);
  const days = Number(match[3] || 0);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);
  const total =
    ((weeks * 7 + days) * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds) *
    1000;
  return sign * total;
}

type ParsedRule = {
  recurrence: "daily" | "weekly" | "monthly" | null;
  monthlyDay?: number;
  until?: Date;
};

/**
 * The subset of RRULE the app can represent. INTERVAL>1 has no equivalent in
 * the task model, so the event still imports but stops repeating rather than
 * silently becoming "every week" when the file said "every other week".
 */
function parseRRule(value: string): ParsedRule {
  const parts: Record<string, string> = {};
  for (const chunk of value.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq < 0) continue;
    const key = chunk.slice(0, eq).trim().toUpperCase();
    if (key) parts[key] = chunk.slice(eq + 1).trim();
  }

  const frequency = (parts.FREQ || "").toUpperCase();
  const recurrence =
    frequency === "DAILY"
      ? "daily"
      : frequency === "WEEKLY"
      ? "weekly"
      : frequency === "MONTHLY"
      ? "monthly"
      : null;
  if (!recurrence) return { recurrence: null };

  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  if (!isFinite(interval) || interval > 1) return { recurrence: null };

  let monthlyDay: number | undefined;
  if (recurrence === "monthly" && parts.BYMONTHDAY) {
    const day = Number(parts.BYMONTHDAY.split(",")[0]);
    if (day === -1) {
      // "Last day of the month" maps exactly onto the app's day-31 clamp.
      monthlyDay = 31;
    } else if (Number.isInteger(day) && day >= 1 && day <= 31) {
      monthlyDay = day;
    }
  }

  const until = parts.UNTIL ? parseIcsUntil(parts.UNTIL) : null;
  return {
    recurrence,
    ...(monthlyDay ? { monthlyDay } : {}),
    ...(until ? { until } : {}),
  };
}

type DescriptionParts = {
  description: string;
  notes: string;
  subtasks: { text: string; completed: boolean }[];
  list?: string;
  tags: string[];
  recurrence?: "daily" | "weekly" | "monthly";
  repeatUntil?: string;
};

/**
 * Read TaskFlow's DESCRIPTION body back into fields. Every marker is optional,
 * and lines that are not recognised stay in the description, so a description
 * written by another calendar survives instead of being discarded.
 */
function parseDescription(raw: string): DescriptionParts {
  const descriptionLines: string[] = [];
  const noteLines: string[] = [];
  const subtasks: { text: string; completed: boolean }[] = [];
  let list: string | undefined;
  let tags: string[] = [];
  let recurrence: DescriptionParts["recurrence"];
  let repeatUntil: string | undefined;
  let mode: "description" | "notes" | "subtasks" = "description";
  let sawNotes = false;

  for (const line of raw.split("\n")) {
    const listMatch = /^List:\s*(.*)$/i.exec(line);
    if (listMatch) {
      list = listMatch[1].trim() || undefined;
      mode = "description";
      continue;
    }

    const tagsMatch = /^Tags:\s*(.*)$/i.exec(line);
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(/\s+/)
        .map((tag) => tag.replace(/^#/, "").trim())
        .filter(Boolean);
      mode = "description";
      continue;
    }

    const repeatMatch = /^Repeats:\s*(.*)$/i.exec(line);
    if (repeatMatch) {
      const text = repeatMatch[1].trim();
      if (/\bdaily\b/i.test(text)) recurrence = "daily";
      else if (/\bweekly\b/i.test(text)) recurrence = "weekly";
      else if (/\bmonthly\b/i.test(text)) recurrence = "monthly";
      const until = /until\s+(\d{4})-(\d{1,2})-(\d{1,2})/i.exec(text);
      if (until && recurrence) {
        const date = new Date(
          Number(until[1]),
          Number(until[2]) - 1,
          Number(until[3]),
          23,
          59,
          59,
          999
        );
        if (!isNaN(date.getTime())) repeatUntil = date.toISOString();
      }
      mode = "description";
      continue;
    }

    if (/^Subtasks\s*\(\d+\s*\/\s*\d+\):\s*$/i.test(line)) {
      mode = "subtasks";
      continue;
    }

    const subtaskMatch = /^\[([ xX])\]\s?(.*)$/.exec(line);
    if (mode === "subtasks" && subtaskMatch) {
      const text = subtaskMatch[2].trim().slice(0, 200);
      if (text) {
        subtasks.push({
          text,
          completed: subtaskMatch[1].toLowerCase() === "x",
        });
      }
      continue;
    }

    const notesMatch = /^Notes:\s?(.*)$/i.exec(line);
    if (!sawNotes && notesMatch) {
      sawNotes = true;
      mode = "notes";
      if (notesMatch[1].trim()) noteLines.push(notesMatch[1]);
      continue;
    }

    if (mode === "notes") noteLines.push(line);
    else if (mode === "description") descriptionLines.push(line);
  }

  return {
    description: descriptionLines.join("\n").trim(),
    notes: noteLines.join("\n").trim(),
    subtasks,
    ...(list ? { list } : {}),
    tags,
    ...(recurrence ? { recurrence } : {}),
    ...(repeatUntil ? { repeatUntil } : {}),
  };
}

function mapPriority(value: string | undefined): string | undefined {
  const priority = Number((value || "").trim());
  if (!Number.isInteger(priority) || priority < 1 || priority > 9) {
    return undefined;
  }
  // RFC 5545: 1 is highest, 5 is medium, 9 lowest, 0 unspecified.
  if (priority <= 4) return "high";
  if (priority === 5) return "medium";
  return "low";
}

function collectBlocks(lines: string[]): IcsBlock[] {
  const blocks: IcsBlock[] = [];
  let current: IcsBlock | null = null;
  let alarm: IcsProperty[] | null = null;

  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;

    if (property.name === "BEGIN") {
      const kind = property.value.trim().toUpperCase();
      if (kind === "VEVENT" || kind === "VTODO") {
        if (!current) current = { kind, props: [], alarms: [] };
        continue;
      }
      if (kind === "VALARM" && current) {
        alarm = [];
        continue;
      }
      continue;
    }

    if (property.name === "END") {
      const kind = property.value.trim().toUpperCase();
      if (kind === "VALARM" && current && alarm) {
        current.alarms.push(alarm);
        alarm = null;
        continue;
      }
      if (
        (kind === "VEVENT" || kind === "VTODO") &&
        current &&
        kind === current.kind
      ) {
        blocks.push(current);
        current = null;
        alarm = null;
      }
      continue;
    }

    if (alarm) alarm.push(property);
    else if (current) current.props.push(property);
  }

  return blocks;
}

/**
 * Turn calendar text into loose task objects for `normalizeImportedTask`, so
 * the calendar, CSV and JSON paths share one validator and one set of caps.
 */
export function icsToTaskSeeds(text: string): IcsImportResult {
  const blocks = collectBlocks(unfoldIcs(text));
  const seeds: IcsTaskSeed[] = [];
  const seenUids = new Set<string>();
  let skipped = 0;

  for (const block of blocks) {
    const get = (name: string) =>
      block.props.find((property) => property.name === name);
    const getAll = (name: string) =>
      block.props.filter((property) => property.name === name);

    if ((get("STATUS")?.value || "").trim().toUpperCase() === "CANCELLED") {
      skipped++;
      continue;
    }

    // A RECURRENCE-ID instance is an edited occurrence of a series whose
    // master event is also in the file. Importing both creates a duplicate.
    if (get("RECURRENCE-ID")) {
      skipped++;
      continue;
    }

    const uid = get("UID")?.value.trim();
    if (uid) {
      if (seenUids.has(uid)) {
        skipped++;
        continue;
      }
      seenUids.add(uid);
    }

    const summary = get("SUMMARY");
    const title = (summary ? icsUnescape(summary.value) : "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    if (!title) {
      skipped++;
      continue;
    }

    const startProperty =
      block.kind === "VTODO"
        ? get("DUE") ?? get("DTSTART")
        : get("DTSTART");
    const start = startProperty
      ? parseIcsDate(startProperty.value, startProperty.params)
      : null;
    if (!start) {
      skipped++;
      continue;
    }
    const startMs = start.getTime();

    const endProperty =
      block.kind === "VTODO" ? get("DUE") : get("DTEND");
    let end = endProperty
      ? parseIcsDate(endProperty.value, endProperty.params)
      : null;
    if (!end) {
      const duration = get("DURATION");
      const durationMs = duration ? parseIcsDuration(duration.value) : null;
      if (durationMs !== null) end = new Date(startMs + durationMs);
    }

    const descriptionProperty = get("DESCRIPTION");
    const parts = parseDescription(
      descriptionProperty ? icsUnescape(descriptionProperty.value) : ""
    );

    const categories: string[] = [];
    for (const property of getAll("CATEGORIES")) {
      categories.push(...splitIcsList(property.value));
    }

    const list = (parts.list || "default").trim().toLowerCase().slice(0, 50);
    // The exporter writes CATEGORIES as list + tags and also repeats them in
    // DESCRIPTION. Union the two sources and drop the list value so a round trip
    // does not turn one tag into two.
    const listKey = (parts.list || "").trim().toLowerCase();
    const tagKeys = new Set<string>();
    const tags: string[] = [];
    for (const candidate of [...parts.tags, ...categories]) {
      const tag = candidate.trim();
      const key = tag.toLowerCase();
      if (!tag || key === listKey || tagKeys.has(key)) continue;
      tagKeys.add(key);
      tags.push(tag);
    }

    let recurrence = parts.recurrence;
    let monthlyDay: number | undefined;
    let repeatUntil: string | undefined;
    const rrule = get("RRULE");
    if (rrule) {
      const rule = parseRRule(rrule.value);
      if (rule.recurrence) {
        recurrence = rule.recurrence;
        monthlyDay = rule.monthlyDay;
        if (rule.until) repeatUntil = rule.until.toISOString();
      } else {
        // Unsupported cadence (YEARLY/HOURLY/INTERVAL>1): keep the event, drop
        // the repeat rather than inventing a different one.
        recurrence = undefined;
      }
    }
    if (recurrence && !repeatUntil && parts.repeatUntil) {
      repeatUntil = parts.repeatUntil;
    }
    if (recurrence === "monthly" && monthlyDay === undefined) {
      monthlyDay = start.getDate();
    }

    let remindAt: string | undefined;
    const alarm = block.alarms[0];
    const trigger = alarm?.find((property) => property.name === "TRIGGER");
    if (trigger) {
      let remindMs: number | null = null;
      if ((trigger.params.VALUE || "").toUpperCase() === "DATE-TIME") {
        const absolute = parseIcsDate(trigger.value, trigger.params);
        remindMs = absolute ? absolute.getTime() : null;
      } else {
        const offset = parseIcsDuration(trigger.value);
        if (offset !== null) {
          // A VTODO alarm is relative to DTSTART, but when the task has only a
          // DUE date that is the only anchor there is. RELATED=END opts into
          // the end of the event instead.
          const relatedToEnd =
            (trigger.params.RELATED || "").toUpperCase() === "END";
          const anchorMs =
            relatedToEnd && end ? end.getTime() : startMs;
          remindMs = anchorMs + offset;
        }
      }
      if (remindMs !== null && remindMs > Date.now()) {
        remindAt = new Date(remindMs).toISOString();
      }
    }

    const status = (get("STATUS")?.value || "").trim().toUpperCase();
    const percent = (get("PERCENT-COMPLETE")?.value || "").trim();
    const completedFlag = get("X-TASKFLOW-COMPLETED");
    const completed = completedFlag
      ? /^(true|1|yes)$/i.test(completedFlag.value.trim())
      : status === "COMPLETED" || percent === "100";

    let completedAt: string | null = null;
    if (completed) {
      const completedProperty =
        get("COMPLETED") ?? get("X-TASKFLOW-COMPLETED-AT");
      const completedDate = completedProperty
        ? parseIcsDate(completedProperty.value, completedProperty.params)
        : null;
      if (completedDate) completedAt = completedDate.toISOString();
    }

    const priority = mapPriority(get("PRIORITY")?.value);
    const seed: IcsTaskSeed = {
      title,
      scheduledAt: start.toISOString(),
      ...(parts.description ? { description: parts.description } : {}),
      ...(parts.notes ? { notes: parts.notes } : {}),
      list,
      ...(priority ? { priority } : {}),
      ...(tags.length ? { tags } : {}),
      ...(parts.subtasks.length ? { subtasks: parts.subtasks } : {}),
      ...(recurrence ? { recurrence } : {}),
      ...(monthlyDay ? { monthlyDay } : {}),
      ...(repeatUntil ? { repeatUntil } : {}),
      ...(remindAt ? { remindAt } : {}),
      ...(completed ? { completed: true, completedAt } : {}),
    };
    seeds.push(seed);
  }

  return { seeds, eventCount: blocks.length, skipped };
}
