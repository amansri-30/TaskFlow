/**
 * CSV import: the read side of `lib/csv.ts`.
 *
 * The exporter is deliberately lossy (it is a spreadsheet, not a backup), but a
 * user who exports, edits a column and re-imports expects their own file to
 * come back. The reader therefore accepts the exported header names, ignores
 * extra columns, and falls back to "first column is the title" so a plain list
 * pasted into a spreadsheet also imports.
 */

/**
 * RFC 4180 reader.
 *
 * Hand-rolled rather than split(",") because a quoted field may contain commas,
 * doubled quotes and newlines — a task title or note with a comma is the normal
 * case, not an edge case, and naive splitting would silently turn one row into
 * three. Returns rows of raw cells; blank lines are dropped because trailing
 * newlines are what spreadsheets write.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      endField();
      continue;
    }
    if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (ch === "\n") {
      endRow();
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length > 0) endRow();

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export type CsvTaskSeed = {
  title: string;
  list?: string;
  priority?: string;
  scheduledAt?: string;
  remindAt?: string;
  recurrence?: string;
  repeatUntil?: string;
  tags?: string[];
  subtasks?: { text: string; completed: boolean }[];
  completed?: boolean;
  completedAt?: string | null;
  pinned?: boolean;
  description?: string;
  notes?: string;
};

type Column =
  | "title"
  | "list"
  | "priority"
  | "due"
  | "reminder"
  | "repeat"
  | "tags"
  | "subtaskDetails"
  | "completed"
  | "completedAt"
  | "pinned"
  | "description"
  | "notes";

// Every name `CSV_HEADER` writes, plus the synonyms people type by hand. Keys
// are already header-normalized (lowercase, single spaces).
const COLUMN_ALIASES: Record<string, Column> = {
  title: "title",
  task: "title",
  "task name": "title",
  name: "title",
  todo: "title",
  item: "title",
  list: "list",
  project: "list",
  category: "list",
  priority: "priority",
  due: "due",
  "due date": "due",
  scheduled: "due",
  "scheduled at": "due",
  date: "due",
  reminder: "reminder",
  "remind at": "reminder",
  remind: "reminder",
  repeat: "repeat",
  recurrence: "repeat",
  repeats: "repeat",
  tags: "tags",
  tag: "tags",
  labels: "tags",
  "subtask details": "subtaskDetails",
  "subtasks detail": "subtaskDetails",
  checklist: "subtaskDetails",
  completed: "completed",
  done: "completed",
  status: "completed",
  "completed at": "completedAt",
  pinned: "pinned",
  pin: "pinned",
  description: "description",
  notes: "notes",
  note: "notes",
};

const headerKey = (cell: string) =>
  cell.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The export's local `YYYY-MM-DD HH:mm` stamp, or anything `Date` understands.
 *
 * The space-separated form cannot go through `new Date(value)`: it is
 * implementation-defined, so Chrome reads it as local time and Safari as
 * invalid. `endOfDay` is for a date with no time (the `Repeat` column's
 * `until`), where using midnight would drop an occurrence that falls on that
 * very day.
 */
function parseCsvDate(raw: string, endOfDay = false): string | null {
  const value = raw.trim();
  if (!value) return null;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(
    value
  );
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hasTime = match[4] !== undefined;
    const hours = hasTime ? Number(match[4]) : endOfDay ? 23 : 0;
    const minutes = hasTime ? Number(match[5]) : endOfDay ? 59 : 0;
    const date = new Date(
      year,
      month - 1,
      day,
      hours,
      minutes,
      endOfDay && !hasTime ? 59 : 0,
      endOfDay && !hasTime ? 999 : 0
    );
    // Reject rollovers such as 2026-02-31, which Date happily normalises.
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date.toISOString();
    }
    return null;
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Undo the formula-injection guard `csvField` adds on export.
 *
 * The exporter prefixes an apostrophe to any cell beginning with `=`, `+`,
 * `-`, `@`, tab or CR so a spreadsheet treats it as text instead of running
 * it. That apostrophe is an artefact of the export, not part of the task:
 * without this step a round-trip turns "- call back" into "'- call back".
 * Only an apostrophe immediately before one of those characters is removed,
 * so text that merely starts with `'` is untouched. The one case that cannot
 * be told apart — a title that genuinely begins `'-` — is read as the guard,
 * which is the far likelier origin.
 */
const unguardCell = (value: string) =>
  /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;

const TRUE_VALUES = /^(y|yes|true|1|done|complete|completed|x|✓)$/i;

const parseBool = (raw: string) => TRUE_VALUES.test(raw.trim());

function parseRepeat(raw: string): Pick<CsvTaskSeed, "recurrence" | "repeatUntil"> {
  const value = raw.trim().toLowerCase();
  if (!value) return {};
  let recurrence: string | undefined;
  if (/\b(daily|every ?day|day)\b/.test(value)) recurrence = "daily";
  else if (/\b(weekly|every ?week|week)\b/.test(value)) recurrence = "weekly";
  else if (/\b(monthly|every ?month|month)\b/.test(value)) recurrence = "monthly";
  if (!recurrence) return {};
  // The exporter writes `Weekly until 2026-11-06`; keep only the end date.
  const until = /until\s+(\d{4}-\d{1,2}-\d{1,2})/.exec(value);
  const repeatUntil = until ? parseCsvDate(until[1], true) : null;
  return repeatUntil ? { recurrence, repeatUntil } : { recurrence };
}

function parseSubtaskDetails(raw: string): { text: string; completed: boolean }[] {
  if (!raw.trim()) return [];
  return raw
    .split("|")
    .map((part) => {
      const match = /^\s*\[([ xX])\]\s*(.*)$/.exec(part);
      if (match) {
        return { completed: match[1].toLowerCase() === "x", text: match[2].trim() };
      }
      return { completed: false, text: part.trim() };
    })
    .filter((item) => item.text.length > 0);
}

/**
 * Turn CSV text into the same loose task objects the JSON importer accepts, so
 * both paths share one normalizer (validation, caps, recurring-task rules, and
 * the reminder-in-the-past guard) instead of drifting apart.
 */
export function csvToTaskSeeds(text: string): CsvTaskSeed[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => COLUMN_ALIASES[headerKey(cell)] ?? null);
  const recognized = header.filter(Boolean).length;
  // A title column, or two recognizable columns, marks the first row as a
  // header. A single-column list of task names must not lose its first task.
  const hasHeader = header.includes("title") || recognized >= 2;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  // Without a header there are no column meanings to honour: a value like
  // "Done" in a plain list of task names is a title, not a completion flag.
  const columns = hasHeader ? header : [];
  const column = (name: Column) => columns.indexOf(name);

  const seeds: CsvTaskSeed[] = [];
  for (const row of dataRows) {
    const cell = (name: Column) => {
      const index = column(name);
      return index >= 0 ? (row[index] ?? "").trim() : "";
    };

    // Without a Title header the first column is the task, which is what a
    // spreadsheet of pasted names looks like.
    const title = unguardCell(cell("title") || (row[0] ?? "").trim());
    if (!title) continue;

    const seed: CsvTaskSeed = { title };

    const list = cell("list");
    // Lists are stored lowercase (the quick-add parser and custom lists both
    // normalize that way), so "Work" and "work" cannot become two sidebars.
    if (list) seed.list = unguardCell(list).toLowerCase();

    const priority = cell("priority").toLowerCase();
    if (priority === "low" || priority === "medium" || priority === "high") {
      seed.priority = priority;
    } else if (priority === "h" || priority === "urgent") {
      seed.priority = "high";
    } else if (priority === "m") {
      seed.priority = "medium";
    } else if (priority === "l") {
      seed.priority = "low";
    }

    const due = parseCsvDate(cell("due"));
    if (due) seed.scheduledAt = due;

    const reminder = parseCsvDate(cell("reminder"));
    // Only a future reminder survives; `normalizeImportedTask` drops the rest,
    // because create rejects an elapsed one.
    if (reminder && new Date(reminder).getTime() > Date.now()) {
      seed.remindAt = reminder;
    }

    Object.assign(seed, parseRepeat(cell("repeat")));

    const tags = unguardCell(cell("tags"))
      .split(/[,;]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length) seed.tags = tags;

    const subtasks = parseSubtaskDetails(cell("subtaskDetails"));
    if (subtasks.length) seed.subtasks = subtasks;

    if (parseBool(cell("completed"))) {
      seed.completed = true;
      seed.completedAt = parseCsvDate(cell("completedAt"));
    }

    if (parseBool(cell("pinned"))) seed.pinned = true;

    const description = unguardCell(cell("description"));
    if (description) seed.description = description;

    const notes = unguardCell(cell("notes"));
    if (notes) seed.notes = notes;

    seeds.push(seed);
  }

  return seeds;
}
