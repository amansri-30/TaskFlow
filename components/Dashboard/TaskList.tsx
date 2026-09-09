"use client";
import React, { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { isSameDay, startOfDay, isBefore } from "date-fns";

import { AddTaskButton } from "./AddTask/AddTaskButton";
import { EditTaskDialogContent } from "./AddTask/EditTaskDialog";
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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [sort, setSort] = useState<SortMode>("smart");

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get("/api/getalltasks");
      setTasks(response.data.tasks || []);
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
    onStatsChange({ today: todayCount, scheduled: scheduledCount });
  }, [tasks, onStatsChange]);

  const lists = Array.from(new Set(tasks.map((t) => t.list).filter(Boolean)));

  useEffect(() => {
    const isListFilter = filter.startsWith("list:");
    if (isListFilter && !lists.includes(filter.slice("list:".length))) {
      onFilterChange("all");
    }
  }, [filter, lists, onFilterChange]);

  const term = search.trim().toLowerCase();
  const today = startOfDay(new Date());

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

  const incomplete = filtered.filter((t) => !t.completed);
  const completed = filtered.filter((t) => t.completed);
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
    : FILTERS.find((f) => f.value === filter)?.label ?? "All";
  const heading = total === 0 ? "All Tasks" : `${activeFilterLabel} Tasks`;

  const handleToggleComplete = async (task: Task, value: boolean) => {
    const previous = tasks;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: value } : t))
    );
    try {
      await axios.patch(`/api/task/${task.id}`, { completed: value });
    } catch {
      setTasks(previous);
      toast.error("Failed to update task");
    }
  };

  const handleDelete = async (task: Task) => {
    const previous = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await axios.delete(`/api/task/${task.id}`);
      toast.success("Task deleted");
    } catch {
      setTasks(previous);
      toast.error("Failed to delete task");
    }
  };

  const handleCompleteAll = async () => {
    const pending = tasks.filter((t) => !t.completed);
    if (pending.length === 0) return;
    const previous = tasks;
    setTasks((prev) => prev.map((t) => ({ ...t, completed: true })));
    try {
      await Promise.all(
        pending.map((t) =>
          axios.patch(`/api/task/${t.id}`, { completed: true })
        )
      );
      toast.success(`${pending.length} task${pending.length > 1 ? "s" : ""} completed`);
    } catch {
      setTasks(previous);
      toast.error("Failed to complete all tasks");
    }
  };

  const handleClearCompleted = async () => {
    const done = tasks.filter((t) => t.completed);
    if (done.length === 0) return;
    const previous = tasks;
    setTasks((prev) => prev.filter((t) => !t.completed));
    try {
      await Promise.all(done.map((t) => axios.delete(`/api/task/${t.id}`)));
      toast.success("Cleared completed tasks");
    } catch {
      setTasks(previous);
      toast.error("Failed to clear completed tasks");
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold md:text-2xl">{heading}</h1>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search tasks..."
            aria-label="Search tasks"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 w-40 md:w-56 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            onClick={() => setEdit(!edit)}
            size="sm"
            variant={edit ? "outline" : "default"}
          >
            {edit ? "Done" : "Edit"}
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
          </div>

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
                  This will permanently delete {completedCount} completed
                  task{completedCount === 1 ? "" : "s"}. This action cannot be
                  undone.
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

          {/* Incomplete Tasks */}
          <div className="flex flex-col py-4 px-2 border rounded-lg border-dashed shadow-sm">
            {sortedIncomplete.length > 0 ? (
              sortedIncomplete.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  edit={edit}
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
  onToggle,
  onDelete,
  onRefresh,
}: {
  task: Task;
  edit: boolean;
  onToggle: (task: Task, value: boolean) => void;
  onDelete: (task: Task) => void;
  onRefresh: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex px-2 items-center justify-between space-x-2 w-full hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition duration-300 ease-in-out group">
      <div className="flex items-center min-w-0">
        <Checkbox
          id={`task-${task.id}`}
          checked={!!task.completed}
          onCheckedChange={(v) => onToggle(task, v === true)}
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
        {task.priority && task.priority !== "medium" && (
          <PriorityChip priority={task.priority} completed={!!task.completed} />
        )}
        {task.scheduledAt && <DueLabel task={task} />}
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
                Are you sure you want to delete &ldquo;{task.title}&rdquo;?
                This action cannot be undone.
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
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (isSameDay(date, tomorrow)) return "Tomorrow";
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