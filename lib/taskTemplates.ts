import type { Subtask, Task } from "@/types";
import { differenceInCalendarDays, startOfDay } from "date-fns";

import { isRecurrence, type Recurrence } from "./recurrence";
import { normalizeTags } from "./tags";

/**
 * Local, per-browser task templates. A template records the reusable shape of
 * a task (title, list, tags, subtasks, repeat cadence) plus *relative* dates,
 * so "quarterly review" saved from a task due today is due on the day it is
 * used instead of carrying the original task's stale calendar date.
 *
 * No API or model changes: applying a template builds the same payload the
 * create endpoint already accepts.
 */
const STORAGE_KEY = "taskflow:taskTemplates";
const MAX_TEMPLATES = 30;

export type TaskTemplate = {
  id: string;
  name: string;
  title: string;
  description: string;
  notes: string;
  list: string;
  priority: "low" | "medium" | "high";
  tags: string[];
  recurrence: Recurrence;
  monthlyDay: number | null;
  dueOffsetDays: number | null;
  dueHour: number | null;
  dueMinute: number | null;
  remindOffsetMinutes: number | null;
  repeatUntilOffsetDays: number | null;
  subtaskTexts: string[];
};

const asString = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const asIntOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;

const asPriority = (value: unknown): TaskTemplate["priority"] =>
  value === "low" || value === "high" ? value : "medium";

function normalizeTemplate(raw: unknown): TaskTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const title = asString(t.title, 120);
  if (!title) return null;
  const name = asString(t.name, 60) || title;
  const recurrence = isRecurrence(t.recurrence) ? t.recurrence : "none";
  const rawDueOffset = asIntOrNull(t.dueOffsetDays);
  const dueOffsetDays = rawDueOffset !== null && rawDueOffset >= 0 ? rawDueOffset : null;
  const subtaskTexts = Array.isArray(t.subtaskTexts)
    ? t.subtaskTexts
        .map((s) => asString(s, 200))
        .filter(Boolean)
        .slice(0, 100)
    : [];
  return {
    id: asString(t.id, 80) || makeId(),
    name,
    title,
    description: asString(t.description, 100),
    notes: asString(t.notes, 4000),
    list: asString(t.list, 50) || "default",
    priority: asPriority(t.priority),
    tags: normalizeTags(t.tags),
    recurrence,
    monthlyDay:
      recurrence === "monthly"
        ? Math.min(31, Math.max(1, asIntOrNull(t.monthlyDay) ?? 1))
        : null,
    dueOffsetDays,
    dueHour: asIntOrNull(t.dueHour),
    dueMinute: asIntOrNull(t.dueMinute),
    remindOffsetMinutes:
      (asIntOrNull(t.remindOffsetMinutes) ?? 0) > 0
        ? asIntOrNull(t.remindOffsetMinutes)
        : null,
    repeatUntilOffsetDays:
      (asIntOrNull(t.repeatUntilOffsetDays) ?? 0) >= 0
        ? asIntOrNull(t.repeatUntilOffsetDays)
        : null,
    subtaskTexts,
  };
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadTaskTemplates(): TaskTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeTemplate)
      .filter((t): t is TaskTemplate => t !== null)
      .slice(0, MAX_TEMPLATES);
  } catch {
    // A corrupt or unavailable localStorage must never break the palette.
    return [];
  }
}

function persist(templates: TaskTemplate[]): TaskTemplate[] {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    } catch {
      // Private mode or a full quota: keep the in-memory result for this session.
    }
  }
  return templates;
}

export function saveTaskTemplate(template: TaskTemplate): TaskTemplate[] {
  const saved = normalizeTemplate(template);
  if (!saved) return loadTaskTemplates();
  const others = loadTaskTemplates().filter((t) => t.id !== saved.id);
  return persist([saved, ...others].slice(0, MAX_TEMPLATES));
}

export function deleteTaskTemplate(id: string): TaskTemplate[] {
  return persist(loadTaskTemplates().filter((t) => t.id !== id));
}

function calendarOffset(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return differenceInCalendarDays(startOfDay(date), startOfDay(now));
}

/** Snapshot a task for reuse. Dates become offsets; completion is dropped. */
export function templateFromTask(task: Task, name: string): TaskTemplate {
  const now = new Date();
  const due = task.scheduledAt ? new Date(task.scheduledAt) : null;
  const dueValid = due && !isNaN(due.getTime());
  const remind = task.remindAt ? new Date(task.remindAt) : null;
  const remindOffset = remind && !isNaN(remind.getTime())
    ? Math.round((remind.getTime() - now.getTime()) / 60_000)
    : 0;
  const recurrence: Recurrence =
    task.recurrence && isRecurrence(task.recurrence) ? task.recurrence : "none";

  return {
    id: makeId(),
    name: name.trim().slice(0, 60) || task.title.trim().slice(0, 60),
    title: task.title.trim().slice(0, 120),
    description: (task.description || "").slice(0, 100),
    notes: (task.notes || "").slice(0, 4000),
    list: task.list || "default",
    priority: asPriority(task.priority),
    tags: normalizeTags(task.tags),
    recurrence,
    monthlyDay:
      recurrence === "monthly"
        ? Math.min(31, Math.max(1, task.monthlyDay ?? (dueValid ? due!.getDate() : 1)))
        : null,
    dueOffsetDays: dueValid
      ? Math.max(0, calendarOffset(task.scheduledAt, now) ?? 0)
      : null,
    dueHour: dueValid ? due!.getHours() : null,
    dueMinute: dueValid ? due!.getMinutes() : null,
    remindOffsetMinutes: remindOffset > 0 ? remindOffset : null,
    repeatUntilOffsetDays:
      recurrence !== "none" && task.repeatUntil
        ? calendarOffset(task.repeatUntil, now)
        : null,
    subtaskTexts: (task.subtasks || [])
      .map((s: Subtask) => (s.text || "").trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 100),
  };
}

function atOffset(days: number | null, hour: number | null, minute: number | null): Date | null {
  if (days === null) return null;
  const date = startOfDay(new Date());
  date.setDate(date.getDate() + days);
  date.setHours(hour ?? 9, minute ?? 0, 0, 0);
  return date;
}

/** Build the ordinary create payload, with stored offsets resolved right now. */
export function createPayloadFromTemplate(
  template: TaskTemplate
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    taskTitle: template.title,
    description: template.description,
    notes: template.notes,
    list: template.list || "default",
    priority: template.priority,
    recurrence: template.recurrence,
    tags: template.tags,
    subtasks: template.subtaskTexts.map((text) => ({ text, completed: false })),
  };

  const due = atOffset(template.dueOffsetDays, template.dueHour, template.dueMinute);
  if (due) payload.dueDate = due.toISOString();

  if (template.recurrence === "monthly" && template.monthlyDay) {
    payload.monthlyDay = template.monthlyDay;
  }
  const until = atOffset(template.repeatUntilOffsetDays, 23, 59);
  if (template.recurrence !== "none" && until) {
    payload.repeatUntil = until.toISOString();
  }
  if (template.remindOffsetMinutes && template.remindOffsetMinutes > 0) {
    payload.remindAt = new Date(
      Date.now() + template.remindOffsetMinutes * 60_000
    ).toISOString();
  }
  return payload;
}

/** Compact one-line preview shown beside a template row in the palette. */
export function templateMeta(template: TaskTemplate): string {
  const parts: string[] = [];
  if (template.list && template.list !== "default") parts.push(`list: ${template.list}`);
  if (template.priority !== "medium") parts.push(`${template.priority} priority`);
  if (template.dueOffsetDays !== null) {
    parts.push(
      template.dueOffsetDays === 0
        ? "due today"
        : template.dueOffsetDays === 1
        ? "due tomorrow"
        : `due in ${template.dueOffsetDays} days`
    );
  }
  if (template.recurrence !== "none") parts.push(template.recurrence);
  if (template.tags.length) parts.push(template.tags.map((t) => `#${t}`).join(" "));
  if (template.subtaskTexts.length) {
    parts.push(`${template.subtaskTexts.length} subtask${template.subtaskTexts.length === 1 ? "" : "s"}`);
  }
  return parts.join("  ·  ");
}
