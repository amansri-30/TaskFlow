"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Pin, CornerDownLeft, Check, CheckCheck } from "lucide-react";
import { Task } from "@/types";
import { reminderLabel } from "@/lib/reminders";

const MAX_RESULTS = 20;

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  onToggleComplete: (task: Task, value: boolean) => void;
  onTogglePin: (task: Task) => void;
  onNavigate: (filter: string) => void;
  onSearch: (term: string) => void;
};

function taskMeta(t: Task): string {
  const parts: string[] = [];
  if (t.priority && t.priority !== "medium") parts.push(t.priority);
  if (t.list && t.list !== "default") parts.push(`list: ${t.list}`);
  if (t.scheduledAt && !isNaN(new Date(t.scheduledAt).getTime())) {
    parts.push(new Date(t.scheduledAt).toLocaleDateString());
  }
  if (t.recurrence && t.recurrence !== "none") parts.push(t.recurrence);
  if (t.remindAt && !isNaN(new Date(t.remindAt).getTime())) {
    parts.push(`remind ${reminderLabel(t.remindAt)}`);
  }
  if ((t.tags || []).length) {
    parts.push((t.tags || []).map((x) => `#${x}`).join(" "));
  }
  return parts.join("  ·  ");
}

export default function CommandPalette({
  open,
  onClose,
  tasks,
  onToggleComplete,
  onTogglePin,
  onNavigate,
  onSearch,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [...tasks].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)).slice(0, MAX_RESULTS);
    }
    const parts = q.split(/\s+/).filter(Boolean);
    return tasks
      .filter((t) => {
        for (const part of parts) {
          if (part.startsWith("#")) {
            const tag = part.slice(1);
            if (!(t.tags || []).some((x) => x.toLowerCase().includes(tag))) return false;
          } else if (part.startsWith("list:")) {
            const list = part.slice(5);
            if (!(t.list || "").toLowerCase().includes(list)) return false;
          } else if (part.startsWith("p:")) {
            const p = part.slice(2);
            if (t.priority !== p) return false;
          } else {
            const haystack = [
              t.title,
              t.description || "",
              t.notes || "",
              t.list || "",
              t.priority || "",
              ...(t.tags || []),
              ...(t.subtasks || []).map((s) => s.text),
            ]
              .join(" ")
              .toLowerCase();
            if (!haystack.includes(part)) return false;
          }
        }
        return true;
      })
      .slice(0, MAX_RESULTS);
  }, [tasks, query]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  const openTask = (t: Task) => {
    onNavigate(t.list && t.list !== "default" ? `list:${t.list}` : "all");
    onSearch(t.title);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + Math.max(1, results.length)) % Math.max(1, results.length));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      onToggleComplete(results[activeIndex], !results[activeIndex].completed);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="top-[12%] sm:max-w-[560px] p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Search tasks</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <CheckCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks...  (try #tag, list:work, p:high)"
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No tasks match &ldquo;{query}&rdquo;
            </p>
          ) : (
            results.map((t, i) => (
              <div
                key={t.id}
                role="option"
                aria-selected={i === activeIndex}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1.5",
                  i === activeIndex && "bg-muted"
                )}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <button
                  aria-label={
                    t.completed ? `Reopen ${t.title}` : `Complete ${t.title}`
                  }
                  title={t.completed ? "Reopen" : "Complete"}
                  onClick={() => {
                    onToggleComplete(t, !t.completed);
                    onClose();
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-background hover:text-primary"
                >
                  {t.completed ? (
                    <CheckCheck className="h-4 w-4" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </button>
                <button
                  aria-label={`${t.pinned ? "Unpin" : "Pin"} ${t.title}`}
                  title={t.pinned ? "Unpin" : "Pin"}
                  onClick={() => onTogglePin(t)}
                  className={cn(
                    "rounded p-1 hover:bg-background",
                    t.pinned
                      ? "text-amber-600"
                      : "text-muted-foreground hover:text-primary"
                  )}
                >
                  <Pin className={cn("h-4 w-4", t.pinned && "fill-amber-500")} />
                </button>
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => openTask(t)}
                >
                  <p className="truncate text-sm font-medium">
                    {t.title}
                    {t.pinned && (
                      <span className="ml-1 text-xs text-amber-600">★</span>
                    )}
                  </p>
                  {taskMeta(t) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {taskMeta(t)}
                    </p>
                  )}
                </div>
                {t.completed && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    done
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span>
            {results.length > 0
              ? `${results.length} of ${tasks.length} tasks`
              : `${tasks.length} tasks`}
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="rounded border px-1">↑</span>
              <span className="rounded border px-1">↓</span>
              <span className="rounded border px-1">↵</span> navigate/complete
            </span>
            <span className="flex items-center gap-1">
              <Pin className="h-3 w-3" /> pin
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <CornerDownLeft className="h-3 w-3" /> jump
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}