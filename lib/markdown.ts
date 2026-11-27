import { format } from "date-fns";
import { dueDateOf } from "./dueGroups";
import { recurrenceLabel } from "./recurrence";
import type { Task } from "@/types";

/** Keep task text from changing the shape of a Markdown checklist. */
function inline(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([*_`\[\]])/g, "\\$1")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDay(value: string): string | null {
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : format(date, "MMM d, yyyy");
}

function dueText(task: Task): string {
  const due = dueDateOf(task);
  if (!due) return "";
  // A date-only import means a local calendar day, not midnight as an instant.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(task.scheduledAt || "");
  return `due ${format(due, dateOnly ? "MMM d, yyyy" : "MMM d, yyyy h:mm a")}`;
}

/**
 * Portable checklist for pasting into docs, issues or chat. Export scope is
 * decided by the caller (selection-aware, except in Trash), just like the CSV
 * and calendar formats.
 */
export function tasksToMarkdown(tasks: Task[], title: string): string {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.list || "Unlisted";
    const group = groups.get(key);
    if (group) group.push(task);
    else groups.set(key, [task]);
  }

  const lines = [`# ${inline(title)}`, ""];
  groups.forEach((items, list) => {
    lines.push(`## ${inline(list)}`, "");
    for (const task of items) {
      const meta: string[] = [];
      const due = dueText(task);
      if (due) meta.push(due);
      const recurrence = recurrenceLabel(task.recurrence);
      if (recurrence) {
        const until = task.repeatUntil ? formatDay(task.repeatUntil) : null;
        meta.push(until ? `${recurrence} until ${until}` : recurrence);
      }
      if (task.priority && task.priority !== "medium") meta.push(task.priority);
      if (task.tags?.length)
        meta.push(task.tags.map((tag: string) => `#${tag}`).join(" "));
      lines.push(
        `- [${task.completed ? "x" : " "}] ${inline(task.title)}${
          meta.length ? ` — ${meta.map(inline).join(" · ")}` : ""
        }`
      );
      if (task.description?.trim()) lines.push(`  > ${inline(task.description)}`);
      if (task.notes?.trim()) lines.push(`  > ${inline(task.notes)}`);
      for (const subtask of task.subtasks || []) {
        lines.push(`  - [${subtask.completed ? "x" : " "}] ${inline(subtask.text)}`);
      }
    }
    lines.push("");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}
