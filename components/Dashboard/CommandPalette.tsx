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
import { Pin, CornerDownLeft, Check, CheckCheck, ArrowRight, Plus } from "lucide-react";
import { Task } from "@/types";
import { reminderLabel } from "@/lib/reminders";
import { deferLabel } from "@/lib/dueDates";
import { matchesFlag, SEARCH_FLAGS } from "@/lib/search";
import { recurrenceLabel } from "@/lib/recurrence";
import { parseQuickAdd } from "@/lib/quickParse";

const MAX_RESULTS = 20;

type PaletteItem =
  | { kind: "create" }
  | { kind: "task"; task: Task }
  | { kind: "nav"; filter: string; label: string };

// Smart views the sidebar can jump to. `keywords` carries the synonyms a user
// is likely to type ("bin" for Trash), and every word of the query must appear
// somewhere in label+keywords+filter, so "go to today" resolves to Today while
// "today exam" does not.
const NAV_VIEWS: { filter: string; label: string; keywords: string }[] = [
  { filter: "all", label: "Go to Inbox", keywords: "all home" },
  { filter: "today", label: "Go to Today", keywords: "today" },
  { filter: "scheduled", label: "Go to Scheduled", keywords: "scheduled upcoming future" },
  { filter: "next7", label: "Go to Next 7 days", keywords: "next7 week seven days" },
  { filter: "overdue", label: "Go to Overdue", keywords: "overdue late behind" },
  { filter: "nodate", label: "Go to No due date", keywords: "nodate undated unscheduled" },
  { filter: "pinned", label: "Go to Pinned", keywords: "pinned star favorites" },
  { filter: "trash", label: "Go to Trash", keywords: "trash deleted bin recycle" },
];

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  onToggleComplete: (task: Task, value: boolean) => void;
  onTogglePin: (task: Task) => void;
  onNavigate: (filter: string) => void;
  onSearch: (term: string) => void;
  onCreateTask: (text: string) => void;
};

function taskMeta(t: Task): string {
  const parts: string[] = [];
  if (t.priority && t.priority !== "medium") parts.push(t.priority);
  if (t.list && t.list !== "default") parts.push(`list: ${t.list}`);
  if (t.scheduledAt && !isNaN(new Date(t.scheduledAt).getTime())) {
    // Same compact, year-eliding format the defer menus and toasts use, so a
    // date never reads one way in the palette and another in the list.
    parts.push(deferLabel(t.scheduledAt));
  }
  if (t.recurrence && t.recurrence !== "none") {
    parts.push(t.repeatUntil ? `${t.recurrence} until ${deferLabel(t.repeatUntil)}` : t.recurrence);
  }
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
  onCreateTask,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

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
          if (part.startsWith("#") && part.length > 1) {
            const tag = part.slice(1);
            if (!(t.tags || []).some((x) => x.toLowerCase().includes(tag))) return false;
          } else {
            // Same operator vocabulary as the main search box: `list:`, `tag:`,
            // `p:`/`priority:` and `is:`. An unknown operator (or an unknown
            // `is:` value) is not a filter — it is treated as plain text, so
            // "is: fine" still finds tasks rather than silently matching none.
            const op = /^(list|tag|p|priority|is):(.*)$/.exec(part);
            const value = op ? op[2] : "";
            if (op && value && op[1] === "list") {
              if (!(t.list || "").toLowerCase().includes(value)) return false;
            } else if (op && value && op[1] === "tag") {
              if (!(t.tags || []).some((x) => x.toLowerCase().includes(value)))
                return false;
            } else if (op && value && (op[1] === "p" || op[1] === "priority")) {
              if ((t.priority || "medium").toLowerCase() !== value) return false;
            } else if (op && value && op[1] === "is" && SEARCH_FLAGS.has(value)) {
              if (!matchesFlag(t, value)) return false;
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
        }
        return true;
      })
      .slice(0, MAX_RESULTS);
  }, [tasks, query]);

  // Anything non-empty can become a task. Parse it with the same grammar the
  // quick-add box uses so the preview ("due Fri", "#home") matches what will
  // actually be saved, and offer a create row ahead of the search results.
  const trimmedQuery = query.trim();
  const createPreview = useMemo(
    () => (trimmedQuery ? parseQuickAdd(trimmedQuery) : null),
    [trimmedQuery]
  );
  const createTitle = createPreview?.title.trim() ?? "";
  const showCreate = createTitle.length > 0;
  const createMeta = createPreview
    ? [
        createPreview.dueDate ? deferLabel(createPreview.dueDate) : "",
        createPreview.priority ? `${createPreview.priority} priority` : "",
        createPreview.recurrence
          ? recurrenceLabel(createPreview.recurrence)
          : "",
        createPreview.tags.length
          ? createPreview.tags.map((t) => `#${t}`).join(" ")
          : "",
      ]
        .filter(Boolean)
        .join("  ·  ")
    : "";

  // View jumps appear only when the query matched no task, so the rows a user
  // asked for ("trash") never crowd out real results that happen to share the
  // word. They sit after the create row: typing "trash" with nothing else
  // matching still defaults to creating a task named "trash", and a view jump
  // is one ↓ away.
  const navRows = useMemo<PaletteItem[]>(() => {
    if (!trimmedQuery || results.length > 0) return [];
    const words = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return NAV_VIEWS.filter((view) => {
      const haystack = `${view.label} ${view.keywords} ${view.filter}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    }).map((view) => ({ kind: "nav", filter: view.filter, label: view.label }));
  }, [trimmedQuery, results.length]);

  // The create row sits after the search results so the default highlight stays
  // on the best existing match — typing "buy milk" to complete a task must not
  // create a second one. When nothing matches, it is the only row and Enter
  // creates, which is exactly what the user wants.
  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = results.map((task) => ({ kind: "task", task }));
    if (showCreate) list.push({ kind: "create" });
    for (const row of navRows) list.push(row);
    return list;
  }, [results, showCreate, navRows]);
  const createIndex = showCreate ? results.length : -1;

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  // The results list scrolls inside a max-h box, so moving the highlight past
  // the fold left it off-screen with no visual cue of which row Enter acts on.
  // The active row is referenced rather than queried by id because task ids
  // contain characters that are awkward to embed in a selector.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items.length]);

  const openTask = (t: Task) => {
    onNavigate(t.list && t.list !== "default" ? `list:${t.list}` : "all");
    onSearch(t.title);
    onClose();
  };

  const activate = (item: PaletteItem) => {
    if (item.kind === "create") {
      onCreateTask(trimmedQuery);
    } else if (item.kind === "nav") {
      // A view jump replaces whatever the sidebar was showing, so the search
      // box is cleared with it — otherwise the new view opens already filtered
      // by the word that got the user here ("trash") and looks empty.
      onNavigate(item.filter);
      onSearch("");
    } else {
      onToggleComplete(item.task, !item.task.completed);
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + Math.max(1, items.length)) % Math.max(1, items.length));
    } else if (e.key === "Enter" && items[activeIndex]) {
      e.preventDefault();
      activate(items[activeIndex]);
    } else if (e.key === "Tab" && items[activeIndex]) {
      // The footer has always advertised "tab to open", but no Tab handler
      // existed: focus just slid into the row's buttons and the highlighted
      // task was never opened, so `openTask` had no keyboard path at all.
      e.preventDefault();
      const item = items[activeIndex];
      if (item.kind === "task") openTask(item.task);
      else activate(item);
    }
  };

  const activeItem = items[activeIndex];
  const activeDescendant = activeItem
    ? activeItem.kind === "create"
      ? "command-palette-option-create"
      : activeItem.kind === "nav"
      ? `command-palette-option-nav-${activeItem.filter}`
      : `command-palette-option-${activeItem.task.id}`
    : undefined;

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
            placeholder="Search tasks...  (try #tag, list:work, p:high, is:overdue)"
            className="border-0 shadow-none focus-visible:ring-0"
            // Focus stays in this input, so the listbox needs explicit
            // combobox wiring or a screen reader never announces which row the
            // arrow keys are on.
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="command-palette-results"
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant}
          />
        </div>
        <div
          id="command-palette-results"
          className="max-h-[50vh] overflow-y-auto p-2"
          role="listbox"
          aria-label="Task search results"
        >
          {results.length === 0 && !showCreate ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No tasks match &ldquo;{query}&rdquo;
            </p>
          ) : (
            results.map((t, i) => (
              <div
                key={t.id}
                id={`command-palette-option-${t.id}`}
                ref={i === activeIndex ? activeRef : null}
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
                <button
                  type="button"
                  onClick={() => openTask(t)}
                  className="min-w-0 flex-1 text-left cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                </button>
                {t.completed && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    done
                  </Badge>
                )}
              </div>
            ))
          )}
          {showCreate && (
            <div
              key="__create__"
              id="command-palette-option-create"
              ref={createIndex === activeIndex ? activeRef : null}
              role="option"
              aria-selected={createIndex === activeIndex}
              className={cn(
                "rounded-md mt-1",
                createIndex === activeIndex && "bg-muted"
              )}
              onMouseEnter={() => setActiveIndex(createIndex)}
            >
              <button
                type="button"
                onClick={() => {
                  onCreateTask(trimmedQuery);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
              >
                <Plus className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    Create &ldquo;{createTitle}&rdquo;
                  </span>
                  {createMeta && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {createMeta}
                    </span>
                  )}
                </span>
                <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          )}
          {navRows.map((row, i) => {
            if (row.kind !== "nav") return null;
            const idx = (createIndex !== -1 ? createIndex + 1 : results.length) + i;
            return (
              <div
                key={row.filter}
                id={`command-palette-option-nav-${row.filter}`}
                ref={idx === activeIndex ? activeRef : null}
                role="option"
                aria-selected={idx === activeIndex}
                className={cn("rounded-md mt-1", idx === activeIndex && "bg-muted")}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <button
                  type="button"
                  onClick={() => activate(row)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                >
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{row.label}</span>
                  <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </div>
            );
          })}
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
            {showCreate && (
              <span className="hidden items-center gap-1 sm:flex">
                <Plus className="h-3 w-3" /> or type to add
              </span>
            )}
            <span className="flex items-center gap-1">
              <Pin className="h-3 w-3" /> pin
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <ArrowRight className="h-3 w-3" /> tab to open
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}