"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "../ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "../ui/button";

import axios from "axios";
import toast from "react-hot-toast";
import { Task } from "@/types";
import {
  Trash2,
  CheckCircle2,
  Circle,
  ListChecks,
  CalendarDays,
  Flag,
  CheckCheck,
  ArrowUpDown,
  Download,
  Upload,
  Undo2,
  TrendingUp,
  Repeat,
} from "lucide-react";
import { isSameDay, startOfDay, isBefore, addDays } from "date-fns";
import { isRecurrence, type Recurrence } from "@/lib/recurrence";
import { normalizeTags } from "@/lib/tags";

import { AddTaskButton } from "./AddTask/AddTaskButton";
import { EditTaskDialogContent } from "./AddTask/EditTaskDialog";
import ActivityHeatmap from "./ActivityHeatmap";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskStats } from "./Dashboard";
import { useAppDispatch } from "@/hooks";
import { userActions } from "@/redux/user/userSlice";

import { useCustomLists } from "@/lib/customLists";
import { listNames } from "@/lib/Data";

import PencilEdit02Icon from "@/public/svg/icons/PencilEdit02Icon";

const emptyTasks: Task[] = [];

const FILTERS = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "scheduled", label: "Scheduled" },
  { value: "overdue", label: "Overdue" },
];

type SortMode = "smart" | "priority" | "due" | "newest" | "title";
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "smart", label: "Smart (priority + due)" },
  { value: "priority", label: "Priority" },
  { value: "due", label: "Due date" },
  { value: "newest", label: "Newest first" },
  { value: "title", label: "Title A–Z" },
];

export default function TaskList({
  filter,
  onFilterChange,
  onStatsChange,
  search,
  onSearchChange,
}: {
  filter: string;
  onFilterChange: (filter: string) => void;
  onStatsChange: (stats: TaskStats) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [tasks, setTasks] = useState<Task[]>(emptyTasks);
  const [trashed, setTrashed] = useState<Task[]>(emptyTasks);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [sort, setSort] = useState<SortMode>("smart");
  const [importing, setImporting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastDeleted, setLastDeleted] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchActionNonce, setBatchActionNonce] = useState(0);
  const customLists = useCustomLists();

  const resetSelection = () => setSelectedIds(new Set());

  const toggleEdit = () => {
    if (edit) resetSelection();
    setEdit((prev) => !prev);
  };

  const handleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const selectedTasks = tasks.filter((t) => selectedIds.has(t.id));
  const selectedIncomplete = selectedTasks.filter((t) => !t.completed);
  const selectedCompleted = selectedTasks.filter((t) => t.completed);

  const handleBatchComplete = async () => {
    if (selectedIncomplete.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const target = selectedIncomplete;
    const hadRecurring = target.some(
      (t) => t.recurrence && t.recurrence !== "none"
    );
    const ids = new Set(target.map((t) => t.id));
    setTasks((prev) =>
      prev.map((t) =>
        ids.has(t.id)
          ? {
              ...t,
              completed: true,
              completedAt: t.completed ? t.completedAt : new Date().toISOString(),
            }
          : t
      )
    );
    const results = await Promise.allSettled(
      target.map((t) => axios.patch(`/api/task/${t.id}`, { completed: true }))
    );
    const failed = target.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      // Only roll back the tasks that actually failed; keep the ones that
      // succeeded on the server so the UI never shows stale state.
      const failedIds = new Set(failed.map((t) => t.id));
      setTasks((prev) =>
        prev.map((t) => (failedIds.has(t.id) ? previous.get(t.id) ?? t : t))
      );
      toast.error(`Failed to complete ${failed.length} of ${target.length} tasks`);
      return;
    }
    toast.success(`Completed ${target.length} task${target.length > 1 ? "s" : ""}`);
    if (hadRecurring) {
      await refreshSilently();
      toast.success("Next occurrences scheduled for repeating tasks");
    }
  };

  const handleBatchReopen = async () => {
    if (selectedCompleted.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const target = selectedCompleted;
    const ids = new Set(target.map((t) => t.id));
    setTasks((prev) =>
      prev.map((t) =>
        ids.has(t.id) ? { ...t, completed: false, completedAt: null } : t
      )
    );
    const results = await Promise.allSettled(
      target.map((t) => axios.patch(`/api/task/${t.id}`, { completed: false }))
    );
    const failed = target.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      setTasks((prev) =>
        prev.map((t) => (failedIds.has(t.id) ? previous.get(t.id) ?? t : t))
      );
      toast.error(`Failed to reopen ${failed.length} of ${target.length} tasks`);
      return;
    }
    toast.success(`Reopened ${target.length} task${target.length > 1 ? "s" : ""}`);
  };

  const handleBatchSetPriority = async (
    priority: NonNullable<Task["priority"]>
  ) => {
    if (selectedTasks.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const target = selectedTasks;
    const ids = new Set(target.map((t) => t.id));
    setTasks((prev) =>
      prev.map((t) => (ids.has(t.id) ? { ...t, priority } : t))
    );
    const results = await Promise.allSettled(
      target.map((t) => axios.patch(`/api/task/${t.id}`, { priority }))
    );
    const failed = target.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      setTasks((prev) =>
        prev.map((t) => (failedIds.has(t.id) ? previous.get(t.id) ?? t : t))
      );
      toast.error(`Failed to update priority for ${failed.length} of ${target.length} tasks`);
      return;
    }
    toast.success(`Priority set to ${priority} for ${target.length} task${target.length > 1 ? "s" : ""}`);
  };

  const handleBatchSetList = async (list: string) => {
    if (selectedTasks.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const target = selectedTasks;
    const ids = new Set(target.map((t) => t.id));
    setTasks((prev) =>
      prev.map((t) => (ids.has(t.id) ? { ...t, list } : t))
    );
    const results = await Promise.allSettled(
      target.map((t) => axios.patch(`/api/task/${t.id}`, { list }))
    );
    const failed = target.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      setTasks((prev) =>
        prev.map((t) => (failedIds.has(t.id) ? previous.get(t.id) ?? t : t))
      );
      toast.error(`Failed to move ${failed.length} of ${target.length} tasks`);
      return;
    }
    toast.success(`Moved ${target.length} task${target.length > 1 ? "s" : ""} to "${list}"`);
  };

  const handleBatchDelete = async () => {
    const target = selectedTasks;
    if (target.length === 0) return;
    const ids = new Set(target.map((t) => t.id));
    setTasks((prev) => prev.filter((t) => !ids.has(t.id)));
    setConfirmBatchDelete(false);
    resetSelection();
    const results = await Promise.allSettled(
      target.map((t) => axios.delete(`/api/task/${t.id}`))
    );
    const failed = target.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      setTasks((prev) => [
        ...prev,
        ...failed.filter((t) => !prev.some((x) => x.id === t.id)),
      ]);
      toast.error(`Failed to move ${failed.length} task${failed.length > 1 ? "s" : ""} to trash`);
      return;
    }
    setTrashed((prev) => [
      ...target.map((t) => ({
        ...t,
        trashed: true,
        trashedAt: new Date().toISOString(),
      })),
      ...prev,
    ]);
    toast.success(`Moved ${target.length} task${target.length > 1 ? "s" : ""} to trash`);
  };

  const handleSelectAllShown = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allShownSelected) {
        filtered.forEach((t) => next.delete(t.id));
      } else {
        filtered.forEach((t) => next.add(t.id));
      }
      return next;
    });
  };

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get("/api/getalltasks");
      setTasks(response.data.tasks || []);
      setTrashed(response.data.trashed || []);
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        dispatch(userActions.resetUser());
        try {
          await axios.post("/api/auth/logout");
        } catch {
          // ignore - cookie may already be gone
        }
        toast.error("Your session has expired. Please log in again.");
        router.replace("/login");
        return;
      }
      setError("Failed fetching tasks. Try refreshing the page.");
      toast.error("Failed fetching tasks. Try refreshing the page.");
      setTasks(emptyTasks);
    } finally {
      setLoading(false);
    }
  }, [dispatch, router]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const total = tasks.length;
  const completedCount = tasks.filter((t) => t.completed).length;
  const pendingCount = total - completedCount;
  const completionPct = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  const weekStart = startOfDay(addDays(new Date(), -6));
  const completedThisWeek = tasks.filter((t) => {
    if (!t.completed || !t.completedAt) return false;
    const d = new Date(t.completedAt);
    return !isNaN(d.getTime()) && !isBefore(d, weekStart);
  }).length;

  useEffect(() => {
    const todayCount = tasks.filter((t) => {
      if (!t.scheduledAt) return false;
      const d = new Date(t.scheduledAt);
      return !isNaN(d.getTime()) && isSameDay(d, new Date());
    }).length;
    const scheduledCount = tasks.filter((t) => {
      if (!t.scheduledAt) return false;
      return !isNaN(new Date(t.scheduledAt).getTime());
    }).length;
    const tagCounts = new Map<string, number>();
    for (const t of tasks) {
      for (const tag of t.tags || []) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const tags = Array.from(tagCounts.entries()).map(([name, count]) => ({
      name,
      count,
    })) as { name: string; count: number }[];
    onStatsChange({ today: todayCount, scheduled: scheduledCount, tags });
  }, [tasks, onStatsChange]);

  const lists = Array.from(new Set(tasks.map((t) => t.list).filter(Boolean)));

  // A list filter is only stale when the list no longer exists anywhere
  // (static lists + custom lists + lists currently used by tasks). A valid
  // but empty list must NOT snap the filter back to "all".
  const knownLists = Array.from(
    new Set([...lists, ...listNames.map((item) => item.name), ...customLists])
  );

  useEffect(() => {
    const isListFilter = filter.startsWith("list:");
    if (isListFilter && !knownLists.includes(filter.slice("list:".length))) {
      onFilterChange("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, knownLists.join("|"), onFilterChange]);

  const term = search.trim().toLowerCase();
  const today = startOfDay(new Date());
  const trashView = filter === "trash";

  const matchesFilter = (t: Task) => {
    if (filter === "today") {
      if (!t.scheduledAt) return false;
      const d = new Date(t.scheduledAt);
      return !isNaN(d.getTime()) && isSameDay(d, new Date());
    }
    if (filter === "scheduled") {
      if (!t.scheduledAt) return false;
      return !isNaN(new Date(t.scheduledAt).getTime());
    }
    if (filter === "overdue") {
      if (!t.scheduledAt || t.completed) return false;
      const d = new Date(t.scheduledAt);
      return !isNaN(d.getTime()) && isBefore(d, today);
    }
    if (filter.startsWith("list:")) {
      return t.list === filter.slice("list:".length);
    }
    if (filter.startsWith("tag:")) {
      return (t.tags || []).includes(filter.slice("tag:".length));
    }
    if (filter.startsWith("priority:")) {
      return t.priority === filter.slice("priority:".length);
    }
    return true;
  };

  const filtered = tasks.filter((t) => {
    if (!matchesFilter(t)) return false;
    if (!term) return true;
    return (
      t.title.toLowerCase().includes(term) ||
      (t.description || "").toLowerCase().includes(term)
    );
  });

  const trashedFiltered = trashView
    ? trashed.filter((t) =>
        term
          ? t.title.toLowerCase().includes(term) ||
            (t.description || "").toLowerCase().includes(term)
          : true
      )
    : [];

  const incomplete = filtered.filter((t) => !t.completed);
  const completed = filtered.filter((t) => t.completed);

  const allShownSelected =
    filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id));
  const batchListOptions = Array.from(
    new Set<string>([...lists, ...customLists])
  );

  // Build tag chips from all active tasks, sorted by popularity.
  const tagCounts = new Map<string, number>();
  for (const t of tasks) {
    for (const tag of t.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  const tagChips = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const dueTime = (t: Task) =>
    t.scheduledAt && !isNaN(new Date(t.scheduledAt).getTime())
      ? new Date(t.scheduledAt).getTime()
      : Number.MAX_SAFE_INTEGER;
  const createdAtTime = (t: Task) =>
    !t.createdAt || isNaN(new Date(t.createdAt).getTime())
      ? 0
      : new Date(t.createdAt).getTime();
  const sortedIncomplete = [...incomplete].sort((a, b) => {
    const rank =
      (priorityRank[a.priority || "medium"] ?? 1) -
      (priorityRank[b.priority || "medium"] ?? 1);
    if (sort === "newest") return createdAtTime(b) - createdAtTime(a);
    if (sort === "title") return a.title.localeCompare(b.title);
    const dueDiff = dueTime(a) - dueTime(b);
    if (sort === "due") {
      if (dueDiff !== 0) return dueDiff;
      return rank;
    }
    if (sort === "priority") return rank;
    if (rank !== 0) return rank;
    return dueDiff;
  });

  const handleExport = () => {
    if (filtered.length === 0) return;
    const payload = {
      app: "TaskFlow",
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      tasks: filtered,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `taskflow-tasks-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} task${filtered.length > 1 ? "s" : ""}`);
  };

  const activeList = filter.startsWith("list:")
    ? filter.slice("list:".length)
    : null;
  const activeFilterLabel = activeList
    ? activeList
    : filter.startsWith("tag:")
    ? `#${filter.slice("tag:".length)}`
    : filter.startsWith("priority:")
    ? `${filter.slice("priority:".length)} priority`
    : FILTERS.find((f) => f.value === filter)?.label ?? "All";
  const heading = trashView
    ? "Trash"
    : total === 0
    ? "All Tasks"
    : `${activeFilterLabel} Tasks`;

  const handleToggleComplete = async (task: Task, value: boolean) => {
    const previousTask = tasks.find((t) => t.id === task.id) ?? task;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              completed: value,
              completedAt: value ? new Date().toISOString() : null,
            }
          : t
      )
    );
    try {
      const response = await axios.patch(`/api/task/${task.id}`, {
        completed: value,
      });
      const nextTask = response.data?.nextTask as Task | null | undefined;
      if (value && nextTask) {
        setTasks((prev) =>
          prev.some((t) => t.id === nextTask.id) ? prev : [...prev, nextTask]
        );
        toast.success("Next occurrence scheduled");
      }
    } catch {
      // Roll back only this task — restoring a whole-task snapshot could
      // clobber concurrent updates from other handlers.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...previousTask } : t
        )
      );
      toast.error("Failed to update task");
    }
  };

  const refreshSilently = useCallback(async () => {
    try {
      const response = await axios.get("/api/getalltasks");
      setTasks(response.data.tasks || []);
      setTrashed(response.data.trashed || []);
    } catch {
      // ignore — next explicit refresh will surface errors
    }
  }, []);

  const handleDelete = async (task: Task) => {
    const previous = new Map(tasks.map((t) => [t.id, t]));
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      // Soft delete — the task is recoverable from Trash.
      await axios.delete(`/api/task/${task.id}`);
      setTrashed((prev) => [
        { ...task, trashed: true, trashedAt: new Date().toISOString() },
        ...prev,
      ]);
      setLastDeleted(task);
      toast.success("Task moved to trash");
    } catch {
      setTasks((prev) =>
        prev.some((t) => t.id === task.id)
          ? prev
          : [...prev, previous.get(task.id) ?? task]
      );
      toast.error("Failed to delete task");
    }
  };

  const restoreTask = async (task: Task) => {
    try {
      // Rewind the soft delete server-side; id and history are preserved.
      await axios.patch(`/api/task/${task.id}`, { restore: true });
      setLastDeleted(null);
      toast.success("Task restored");
      await refreshSilently();
    } catch {
      toast.error("Could not restore task");
    }
  };

  type ImportPayload = {
    taskTitle: string;
    description: string;
    dueDate: string | null;
    list: string;
    priority: string;
    recurrence: Recurrence;
    tags: string[];
  };

  const normalizeImportedTask = (item: any): ImportPayload | null => {
    if (!item || typeof item !== "object") return null;
    const title =
      typeof item.title === "string" ? item.title.trim() : "";
    if (!title || title.length > 120) return null;
    const priority = ["low", "medium", "high"].includes(item.priority)
      ? item.priority
      : "medium";
    const rawDate = item.scheduledAt ?? item.date ?? null;
    let dueDate: string | null = null;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) dueDate = d.toISOString();
    }
    const list =
      typeof item.list === "string" && item.list.trim()
        ? item.list.trim()
        : "default";
    const description =
      typeof item.description === "string" && item.description.trim()
        ? item.description.trim().slice(0, 100)
        : "";
    const recurrence: Recurrence = isRecurrence(item.recurrence)
      ? item.recurrence
      : isRecurrence(item.repeat)
      ? item.repeat
      : "none";
    return {
      taskTitle: title,
      description,
      dueDate,
      list,
      priority,
      recurrence,
      tags: normalizeTags(item.tags),
    };
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as any;
      const raw = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.tasks)
        ? parsed.tasks
        : null;
      const items = raw as any[] | null;
      if (!items) {
        toast.error("Invalid file: expected a tasks array");
        return;
      }
      if (items.length === 0) {
        toast.error("The file contains no tasks");
        return;
      }
      if (items.length > 500) {
        toast.error("Too many tasks (max 500 per import)");
        return;
      }
      const payloads = items
        .map(normalizeImportedTask)
        .filter((p): p is ImportPayload => p !== null);
      if (payloads.length === 0) {
        toast.error("No valid tasks found in the file");
        return;
      }
      let ok = 0;
      let fail = 0;
      for (const payload of payloads) {
        try {
          await axios.post("/api/newtask", payload);
          ok++;
        } catch {
          fail++;
        }
      }
      const skipped = items.length - payloads.length;
      if (ok > 0) {
        toast.success(`Imported ${ok} of ${payloads.length} tasks`);
      }
      if (fail > 0) toast.error(`${fail} task${fail > 1 ? "s" : ""} failed`);
      if (skipped > 0) {
        toast(`Skipped ${skipped} invalid entr${skipped === 1 ? "y" : "ies"}`);
      }
      refresh();
    } catch {
      toast.error("Could not read the file. Make sure it is valid JSON.");
    } finally {
      setImporting(false);
    }
  };

  const handleCompleteAll = async () => {
    const pending = tasks.filter((t) => !t.completed);
    if (pending.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const hadRecurring = pending.some(
      (t) => t.recurrence && t.recurrence !== "none"
    );
    setTasks((prev) =>
      prev.map((t) => ({
        ...t,
        completed: true,
        completedAt: t.completed ? t.completedAt : new Date().toISOString(),
      }))
    );
    const results = await Promise.allSettled(
      pending.map((t) =>
        axios.patch(`/api/task/${t.id}`, { completed: true })
      )
    );
    const failed = pending.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      setTasks((prev) =>
        prev.map((t) => (failedIds.has(t.id) ? previous.get(t.id) ?? t : t))
      );
      toast.error(`Failed to complete ${failed.length} of ${pending.length} tasks`);
      return;
    }
    toast.success(`${pending.length} task${pending.length > 1 ? "s" : ""} completed`);
    if (hadRecurring) {
      await refreshSilently();
      toast.success("Next occurrences scheduled for repeating tasks");
    }
  };

  const handleClearCompleted = async () => {
    const done = tasks.filter((t) => t.completed);
    if (done.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    setTasks((prev) => prev.filter((t) => !t.completed));
    const results = await Promise.allSettled(
      done.map((t) => axios.delete(`/api/task/${t.id}`))
    );
    const failed = done.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      setTasks((prev) =>
        prev.map((t) => (failedIds.has(t.id) ? previous.get(t.id) ?? t : t))
      );
      toast.error(`Failed to move ${failed.length} task${failed.length > 1 ? "s" : ""} to trash`);
      return;
    }
    setTrashed((prev) => [
      ...done.map((t) => ({
        ...t,
        trashed: true,
        trashedAt: new Date().toISOString(),
      })),
      ...prev,
    ]);
    toast.success("Cleared completed tasks (moved to trash)");
  };

  const handleRestoreTrashed = async (task: Task) => {
    try {
      await axios.patch(`/api/task/${task.id}`, { restore: true });
      setTrashed((prev) => prev.filter((t) => t.id !== task.id));
      setLastDeleted((prev) => (prev?.id === task.id ? null : prev));
      await refreshSilently();
      toast.success("Task restored from trash");
    } catch {
      toast.error("Could not restore task");
    }
  };

  const handleDeleteForever = async (task: Task) => {
    if (
      !window.confirm(
        `Permanently delete "${task.title}"? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await axios.delete(`/api/task/${task.id}?permanent=true`);
      setTrashed((prev) => prev.filter((t) => t.id !== task.id));
      setLastDeleted((prev) => (prev?.id === task.id ? null : prev));
      toast.success("Task permanently deleted");
    } catch {
      toast.error("Could not delete task");
    }
  };

  const handleEmptyTrash = async () => {
    if (trashed.length === 0) return;
    if (
      !window.confirm(
        `Permanently delete all ${trashed.length} task${trashed.length > 1 ? "s" : ""} in trash? This cannot be undone.`
      )
    ) {
      return;
    }
    const results = await Promise.allSettled(
      trashed.map((t) => axios.delete(`/api/task/${t.id}?permanent=true`))
    );
    const failed = trashed.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      setTrashed((prev) =>
        prev.filter((t) => failed.some((f) => f.id === t.id))
      );
      toast.error(
        `Failed to permanently delete ${failed.length} task${failed.length > 1 ? "s" : ""}`
      );
      return;
    }
    setTrashed(emptyTasks);
    setLastDeleted(null);
    toast.success("Trash emptied");
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold md:text-2xl">{heading}</h1>
        <div className="flex items-center gap-2">
          <Button
            onClick={toggleEdit}
            size="sm"
            variant={edit ? "outline" : "default"}
          >
            {edit ? "Done" : "Select"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="py-8 text-center text-muted-foreground" role="alert">
          <p>{error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onSearchChange("");
                onFilterChange("all");
                refresh();
              }}
            >
              Retry
            </Button>
            <Button
              variant="default"
              onClick={() => router.replace("/login")}
            >
              Go to Login
            </Button>
          </div>
        </div>
      ) : loading ? (
        <TaskItemsSkeleton />
      ) : trashView ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Tasks here were moved to trash. Restore them to keep them, or
              delete them permanently.
            </p>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleEmptyTrash}
              disabled={trashed.length === 0}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Empty trash
              <span className="ml-1 text-muted-foreground">({trashed.length})</span>
            </Button>
          </div>

          {trashedFiltered.length > 0 ? (
            <div className="flex flex-col py-4 px-2 border rounded-lg border-dashed shadow-sm">
              {trashedFiltered.map((task) => (
                <div
                  key={task.id}
                  className="flex px-2 items-center justify-between space-x-2 w-full rounded-lg transition duration-300 ease-in-out group hover:bg-gray-100 dark:hover:bg-neutral-800"
                >
                  <div className="flex items-center min-w-0 gap-2">
                    <span className="text-sm font-medium p-2 leading-none truncate">
                      {task.title}
                    </span>
                    {task.scheduledAt && <DueLabel task={task} />}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRestoreTrashed(task)}
                    >
                      <Undo2 className="mr-1.5 h-4 w-4" />
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteForever(task)}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              <div className="px-1 mt-1 text-xs text-muted-foreground">
                {trashedFiltered.length} trashed task
                {trashedFiltered.length === 1 ? "" : "s"}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <p>{term ? "No matching trashed tasks" : "Trash is empty."}</p>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Overview / Stats */}
          <section
            aria-label="Task overview"
            className="rounded-lg border bg-card text-card-foreground shadow-sm p-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Overview</h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
              <Stat
                icon={<ListChecks className="h-4 w-4" />}
                label="Total"
                value={total}
              />
              <Stat
                icon={<Circle className="h-4 w-4" />}
                label="Pending"
                value={pendingCount}
              />
              <Stat
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Completed"
                value={completedCount}
              />
              <Stat
                icon={<TrendingUp className="h-4 w-4" />}
                label="This Week"
                value={completedThisWeek}
              />
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={completionPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Task completion"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {completionPct}% of tasks completed
            </p>

            {/* Activity — 12-week heatmap with streaks */}
            <div className="mt-4">
              <ActivityHeatmap tasks={tasks} />
            </div>
          </section>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2" aria-label="Filter tasks">
            {FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                active={filter === f.value}
                onClick={() => onFilterChange(f.value)}
                label={f.label}
              />
            ))}
            {lists.map((list) => (
              <FilterChip
                key={list}
                active={filter === `list:${list}`}
                onClick={() => onFilterChange(`list:${list}`)}
                label={list}
              />
            ))}
            {tagChips.map(([name, count]) => (
              <FilterChip
                key={`tag:${name}`}
                active={filter === `tag:${name}`}
                onClick={() => onFilterChange(`tag:${name}`)}
                label={`#${name} (${count})`}
              />
            ))}
            {(["high", "medium", "low"] as const).map((p) => (
              <FilterChip
                key={`priority:${p}`}
                active={filter === `priority:${p}`}
                onClick={() => onFilterChange(`priority:${p}`)}
                label={`${p} priority`}
              />
            ))}
          </div>

          {/* Batch select toolbar — visible when Edit/Select mode is on */}
          {edit && (
            <div
              className={`rounded-lg border p-3 transition-colors ${
                selectedIds.size > 0
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                  : "border-dashed border-muted-foreground/30"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {selectedIds.size > 0 ? (
                  <>
                    <span className="text-sm font-semibold tabular-nums">
                      {selectedIds.size} selected
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleSelectAllShown}
                    >
                      {allShownSelected ? "Deselect all" : "Select all shown"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={resetSelection}>
                      Clear
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Click checkboxes to select multiple tasks for batch actions.
                  </p>
                )}
              </div>

              {selectedIds.size > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-emerald-200 dark:border-emerald-800 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBatchComplete}
                    disabled={selectedIncomplete.length === 0}
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBatchReopen}
                    disabled={selectedCompleted.length === 0}
                  >
                    <Undo2 className="mr-1.5 h-4 w-4" />
                    Reopen
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Flag className="h-4 w-4 text-muted-foreground" />
                    <Select
                      key={`pri-${batchActionNonce}`}
                      onValueChange={(v) => {
                        setBatchActionNonce((n) => n + 1);
                        handleBatchSetPriority(
                          v as NonNullable<Task["priority"]>
                        );
                      }}
                    >
                      <SelectTrigger
                        className="h-8 min-w-[130px]"
                        aria-label="Set priority for selected"
                      >
                        <SelectValue placeholder="Set priority" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {batchListOptions.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <ListChecks className="h-4 w-4 text-muted-foreground" />
                      <Select
                        key={`list-${batchActionNonce}`}
                        onValueChange={(v) => {
                          setBatchActionNonce((n) => n + 1);
                          handleBatchSetList(v);
                        }}
                      >
                        <SelectTrigger
                          className="h-8 min-w-[130px]"
                          aria-label="Move selected to list"
                        >
                          <SelectValue placeholder="Move to list" />
                        </SelectTrigger>
                        <SelectContent>
                          {batchListOptions.map((l) => (
                            <SelectItem key={l} value={l}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setConfirmBatchDelete(true)}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Bulk actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCompleteAll}
              disabled={pendingCount === 0}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" />
              Complete all
              <span className="ml-1 text-muted-foreground">({pendingCount})</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmClear(true)}
              disabled={completedCount === 0}
              className="text-red-600 hover:text-red-600"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Clear completed
              <span className="ml-1 text-muted-foreground">({completedCount})</span>
            </Button>
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                <SelectTrigger
                  className="h-8 min-w-[180px] gap-1"
                  aria-label="Sort tasks"
                >
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {lastDeleted ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => restoreTask(lastDeleted)}
                className="text-emerald-600 hover:text-emerald-600"
              >
                <Undo2 className="mr-1.5 h-4 w-4" />
                Undo delete
              </Button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Import tasks from JSON"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {importing ? "Importing..." : "Import"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={filtered.length === 0}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} shown
            </span>
          </div>

          {/* Clear completed confirmation */}
          <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>Clear completed tasks?</DialogTitle>
                <DialogDescription>
                  This will move {completedCount} completed task
                  {completedCount === 1 ? "" : "s"} to Trash. You can restore
                  them from Trash later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex gap-2 sm:justify-end">
                <Button variant="outline" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmClear(false);
                    handleClearCompleted();
                  }}
                >
                  Clear
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Batch delete confirmation */}
          <Dialog open={confirmBatchDelete} onOpenChange={setConfirmBatchDelete}>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>Delete {selectedIds.size} task{selectedIds.size === 1 ? "" : "s"}?</DialogTitle>
                <DialogDescription>
                  This will move{" "}
                  {selectedTasks.length === 0
                    ? "the selected tasks"
                    : `"${selectedTasks
                        .slice(0, 3)
                        .map((t) => t.title)
                        .join('", "')}${selectedTasks.length > 3 ? '" and more' : '"'}`}{" "}
                  to Trash. You can restore them from Trash later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex gap-2 sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => setConfirmBatchDelete(false)}
                >
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleBatchDelete}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Incomplete Tasks */}
          <div className="flex flex-col py-4 px-2 border rounded-lg border-dashed shadow-sm">
            {sortedIncomplete.length > 0 ? (
              sortedIncomplete.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  edit={edit}
                  selected={selectedIds.has(task.id)}
                  onSelect={handleSelect}
                  onToggle={handleToggleComplete}
                  onDelete={handleDelete}
                  onRefresh={refresh}
                />
              ))
            ) : (
              <p className="text-muted-foreground">
                {term || filter !== "all"
                  ? "No matching tasks"
                  : "No tasks yet — add one below!"}
              </p>
            )}
            <div className="px-1 mt-1">
              <AddTaskButton onTaskAdded={refresh} />
            </div>
          </div>

          {/* Completed Tasks */}
          {completed.length > 0 && (
            <>
              <h6 className="font-semibold mb-0">
                Completed Tasks ({completed.length})
              </h6>
              <div className="flex flex-col py-4 px-2 border rounded-lg border-dashed shadow-sm">
                {completed.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    edit={edit}
                    selected={selectedIds.has(task.id)}
                    onSelect={handleSelect}
                    onToggle={handleToggleComplete}
                    onDelete={handleDelete}
                    onRefresh={refresh}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

// --------------------------------------------------------------------------------------

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// --------------------------------------------------------------------------------------

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors ${
        active
          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          : "border-input text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

// --------------------------------------------------------------------------------------

function TaskItem({
  task,
  edit,
  selected,
  onSelect,
  onToggle,
  onDelete,
  onRefresh,
}: {
  task: Task;
  edit: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (task: Task, value: boolean) => void;
  onDelete: (task: Task) => void;
  onRefresh: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={`flex px-2 items-center justify-between space-x-2 w-full rounded-lg transition duration-300 ease-in-out group ${
        selected
          ? "bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-300 dark:ring-emerald-800"
          : "hover:bg-gray-100 dark:hover:bg-neutral-800"
      }`}
    >
      <div className="flex items-center min-w-0">
        <Checkbox
          id={`task-${task.id}`}
          checked={edit ? selected : !!task.completed}
          onCheckedChange={(v) =>
            edit ? onSelect(task.id) : onToggle(task, v === true)
          }
          aria-label={
            edit ? `Select ${task.title}` : `Mark ${task.title} as done`
          }
        />
        <label
          htmlFor={`task-${task.id}`}
          className={`text-sm font-medium p-2 leading-none truncate cursor-pointer ${
            task.completed ? "line-through text-muted-foreground" : ""
          }`}
        >
          {task.title}
        </label>
      </div>
      <div
        className={`flex items-center gap-1 shrink-0 transition-opacity ${
          edit ? "" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {(task.tags || []).slice(0, 3).map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
        {task.priority && task.priority !== "medium" && (
          <PriorityChip priority={task.priority} completed={!!task.completed} />
        )}
        {task.scheduledAt && <DueLabel task={task} />}
        {task.recurrence && task.recurrence !== "none" && (
          <RecurrenceLabel recurrence={task.recurrence} />
        )}
        <Dialog>
          <DialogTrigger asChild>
            <button aria-label={`Edit ${task.title}`} className="p-1 hover:bg-muted rounded">
              <PencilEdit02Icon className="h-4 w-4" />
            </button>
          </DialogTrigger>
          <EditTaskDialogContent task={task} onSaved={onRefresh} />
        </Dialog>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogTrigger asChild>
            <button
              aria-label={`Delete ${task.title}`}
              className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Delete task?</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete &ldquo;{task.title}&rdquo;? It
                will be moved to Trash and can be restored later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete(task);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------

function TagChip({ tag }: { tag: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
      #{tag}
    </span>
  );
}

// --------------------------------------------------------------------------------------

function PriorityChip({
  priority,
  completed,
}: {
  priority: NonNullable<Task["priority"]>;
  completed: boolean;
}) {
  const tone =
    priority === "high"
      ? "text-red-600 border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
      : priority === "low"
      ? "text-sky-600 border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40"
      : "text-amber-600 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40";

  return (
    <span
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs capitalize ${
        completed ? "opacity-50" : ""
      } ${tone}`}
    >
      <Flag className="h-3 w-3" />
      {priority}
    </span>
  );
}

// --------------------------------------------------------------------------------------

function RecurrenceLabel({ recurrence }: { recurrence: Recurrence }) {
  return (
    <span
      className="flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
      title={`Repeats ${recurrence}`}
    >
      <Repeat className="h-3 w-3" />
      {recurrence}
    </span>
  );
}

// --------------------------------------------------------------------------------------

function DueLabel({ task }: { task: Task }) {
  const { scheduledAt, completed } = task;
  const due = scheduledAt ? new Date(scheduledAt) : null;
  const invalid = !due || isNaN(due.getTime());
  if (invalid || !due) return null;

  const today = new Date();
  let label: string;
  let tone: string;

  if (isSameDay(due, today)) {
    label = "Today";
    tone = completed
      ? "text-muted-foreground"
      : "text-amber-600";
  } else if (!completed && isBefore(due, startOfDay(today))) {
    label = `Overdue`;
    tone = "text-red-600";
  } else {
    label = dateFnsFormat(due);
    tone = completed ? "text-muted-foreground" : "text-muted-foreground";
  }

  return (
    <span
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${tone}`}
      title={due.toLocaleString()}
    >
      <CalendarDays className="h-3 w-3" />
      {label}
    </span>
  );
}

function dateFnsFormat(date: Date): string {
  const today = startOfDay(new Date());
  // addDays is DST-safe; the old +24h arithmetic could skip/duplicate a day
  // across a daylight-saving boundary.
  if (isSameDay(date, addDays(today, 1))) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// --------------------------------------------------------------------------------------

function TaskItemsSkeleton() {
  return (
    <section
      aria-label="Loading tasks"
      className="flex flex-col gap-4 p-4 border rounded-lg"
    >
      <Skeleton className="h-4 w-[250px]" />
      <Skeleton className="h-4 w-[200px]" />
      <Skeleton className="h-4 w-[250px]" />
      <Skeleton className="h-4 w-[200px]" />
      <Skeleton className="h-4 w-[250px]" />
    </section>
  );
}