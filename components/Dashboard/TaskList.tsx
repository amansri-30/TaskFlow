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
} from "lucide-react";
import { isSameDay, startOfDay, isBefore } from "date-fns";

import { AddTaskButton } from "./AddTask/AddTaskButton";
import { EditTaskDialogContent } from "./AddTask/EditTaskDialog";
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

export default function TaskList({
  filter,
  onFilterChange,
  onStatsChange,
}: {
  filter: string;
  onFilterChange: (filter: string) => void;
  onStatsChange: (stats: TaskStats) => void;
}) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [tasks, setTasks] = useState<Task[]>(emptyTasks);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get("/api/getalltasks");
      setTasks(response.data.tasks || []);
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        dispatch(userActions.resetUser());
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
            onChange={(e) => setSearch(e.target.value)}
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
                setSearch("");
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

          {/* Incomplete Tasks */}
          <div className="flex flex-col py-4 px-2 border rounded-lg border-dashed shadow-sm">
            {incomplete.length > 0 ? (
              incomplete.map((task) => (
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
      <div className="flex items-center gap-1 shrink-0">
        {task.scheduledAt && <DueLabel task={task} />}
        {edit && (
          <>
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
          </>
        )}
      </div>
    </div>
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