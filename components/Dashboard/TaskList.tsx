"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "../ui/skeleton";
import {
  Dialog,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "../ui/button";

import axios from "axios";
import toast from "react-hot-toast";
import { Task } from "@/types";
import { Trash2 } from "lucide-react";

import { AddTaskButton } from "./AddTask/AddTaskButton";
import { EditTaskDialogContent } from "./AddTask/EditTaskDialog";

import TickDouble03Icon from "@/public/svg/icons/TickDouble03Icon";
import PencilEdit02Icon from "@/public/svg/icons/PencilEdit02Icon";

const emptyTasks: Task[] = [];

export default function TaskList() {
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
    } catch {
      setError("Failed fetching tasks. Try refreshing the page.");
      toast.error("Failed fetching tasks. Try refreshing the page.");
      setTasks(emptyTasks);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const incomplete = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  const term = search.trim().toLowerCase();
  const visibleIncomplete = term
    ? incomplete.filter(
        (t) =>
          t.title.toLowerCase().includes(term) ||
          (t.description || "").toLowerCase().includes(term)
      )
    : incomplete;

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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">All Tasks</h1>
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
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setSearch("");
              refresh();
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          {/* Incomplete Tasks */}
          <div className="flex flex-col py-4 px-2 border rounded-lg border-dashed shadow-sm">
            {loading ? (
              <TaskItemsSkeleton show={true} />
            ) : visibleIncomplete.length > 0 ? (
              visibleIncomplete.map((task) => (
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
                {term ? "No matching tasks" : "No tasks yet — add one below!"}
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

          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <TickDouble03Icon className="h-4 w-4" />
            <p>{completed.length} Completed Tasks</p>
          </div>
        </>
      )}
    </main>
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
            <button
              aria-label={`Delete ${task.title}`}
              onClick={() => onDelete(task)}
              className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------

function TaskItemsSkeleton({ show }: { show: boolean }) {
  return (
    <>
      <Skeleton className="h-4 mb-2 w-[250px]" />
      <Skeleton className="h-4 mb-2 w-[200px]" />
      {show && (
        <>
          <Skeleton className="h-4 mb-2 w-[250px]" />
          <Skeleton className="h-4 mb-2 w-[200px]" />
        </>
      )}
    </>
  );
}
