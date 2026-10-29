import type { Task } from "@/types";
import { recurrenceLabel } from "./recurrence";

/**
 * RFC 4180 field encoding.
 *
 * A field only needs quotes when it contains a comma, a quote or a line break;
 * doing it unconditionally is also valid but makes the file unreadable in a
 * text editor and triples its size. Embedded quotes are doubled, which is the
 * only escape the format defines — a backslash escape would be silently wrong
 * in every spreadsheet.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Formula injection: a cell whose text begins with one of these is executed
  // as a formula by Excel/Sheets on open. Task text is user-supplied, and an
  // export is exactly the artefact that gets mailed to someone else, so a
  // leading apostrophe (the spreadsheet's "treat as text" marker) neutralises
  // it. Quoting alone does not help — the formula is evaluated after parsing.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows of cells to a document. CRLF is what the format asks for. */
export function toCsv(rows: unknown[][]): string {
  return `${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A local `YYYY-MM-DD HH:mm` stamp.
 *
 * ISO strings are unambiguous but a spreadsheet shows them as text until the
 * user runs a conversion; this shape is recognised as a date in Excel, Sheets
 * and Numbers while still reading correctly to a human. The timezone is the
 * one the export was taken in, which is the only one the user cares about
 * here — the JSON backup keeps the exact instants.
 */
export function csvTimestamp(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function repeatCell(task: Task): string {
  if (!task.recurrence || task.recurrence === "none") return "";
  const label = recurrenceLabel(task.recurrence);
  const until = csvTimestamp(task.repeatUntil).slice(0, 10);
  return until ? `${label} until ${until}` : label;
}

function subtasksCell(task: Task): string {
  const subtasks = task.subtasks || [];
  if (subtasks.length === 0) return "";
  const done = subtasks.filter((s) => s.completed).length;
  return `${done}/${subtasks.length}`;
}

function subtaskDetailCell(task: Task): string {
  return (task.subtasks || [])
    .map((s) => `${s.completed ? "[x]" : "[ ]"} ${s.text}`)
    .join(" | ");
}

export const CSV_HEADER = [
  "Title",
  "List",
  "Priority",
  "Due",
  "Reminder",
  "Repeat",
  "Tags",
  "Subtasks",
  "Subtask details",
  "Completed",
  "Completed at",
  "Created at",
  "Pinned",
  "Description",
  "Notes",
];

/**
 * One row per task, in the order given (the caller passes what is on screen,
 * so the CSV matches the visible list). Newlines inside notes and descriptions
 * are preserved and quoted, which is the one thing naive exporters get wrong.
 */
export function tasksToCsv(tasks: Task[]): string {
  const rows = tasks.map((task) => [
    task.title,
    task.list || "default",
    task.priority || "medium",
    csvTimestamp(task.scheduledAt),
    csvTimestamp(task.remindAt),
    repeatCell(task),
    (task.tags || []).join(", "),
    subtasksCell(task),
    subtaskDetailCell(task),
    task.completed ? "yes" : "no",
    csvTimestamp(task.completedAt),
    csvTimestamp(task.createdAt),
    task.pinned ? "yes" : "no",
    task.description || "",
    task.notes || "",
  ]);
  return toCsv([CSV_HEADER, ...rows]);
}
