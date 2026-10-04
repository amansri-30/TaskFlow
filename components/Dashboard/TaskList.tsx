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
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import axios from "axios";
import toast from "react-hot-toast";
import { Task, Subtask } from "@/types";
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
  History,
  TrendingUp,
  Repeat,
  Copy,
  Pin,
  TimerReset,
  StickyNote,
  Bell,
  BellRing,
  CalendarClock,
  Hash,
  Plus,
  Minus,
  X,
} from "lucide-react";
import { isSameDay, startOfDay, isBefore, addDays, isAfter } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isRecurrence, type Recurrence } from "@/lib/recurrence";
import {
  reminderLabel,
  isReminderDue,
  REMINDER_PRESETS,
  resolveReminderAt,
  type ReminderPresetId,
} from "@/lib/reminders";
import { normalizeTags } from "@/lib/tags";
import {
  groupTasksByDue,
  groupLabel,
  hasDueDate,
  isDueWithinDays,
  SMART_FILTER_LABELS,
  type DueGroup,
} from "@/lib/dueGroups";
import {
  DEFER_PRESETS,
  resolveDeferPreset,
  deferLabel,
} from "@/lib/dueDates";

import { AddTaskButton } from "./AddTask/AddTaskButton";
import { EditTaskDialogContent } from "./AddTask/EditTaskDialog";
import ActivityHeatmap from "./ActivityHeatmap";
import CommandPalette from "./CommandPalette";
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
  { value: "pinned", label: "Pinned" },
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

/**
 * The exact field set a reschedule owns. Every defer path reconciles and rolls
 * back with this and nothing else, so a concurrent update on the same row (a
 * pin, a subtask tick, a tag edit) is never clobbered by another tab's stale
 * snapshot. It is also the reason `scheduledAt` is normalised here: the server
 * may return null for "no due date" while the row stores undefined.
 */
const dateFields = (t: Task) => ({
  scheduledAt: t.scheduledAt ?? undefined,
  monthlyDay: t.monthlyDay,
  remindAt: t.remindAt ?? null,
  remindedAt: t.remindedAt ?? null,
});

/** The field set the reminder controls own — a sibling of `dateFields`. */
const reminderFields = (t: Task) => ({
  remindAt: t.remindAt ?? null,
  remindedAt: t.remindedAt ?? null,
});

const GROUP_PREF_KEY = "taskflow:groupByDue";

/**
 * An undoable action, newest last. `edit` entries store a per-row PATCH body
 * rather than a task snapshot, so replaying one touches exactly the fields it
 * changed and cannot clobber an unrelated concurrent edit.
 */
type UndoEntry =
  | { kind: "delete"; label: string; at: number; ids: string[] }
  | {
      kind: "edit";
      label: string;
      at: number;
      prev: { id: string; patch: Record<string, unknown> }[];
    };

/** How many batch actions stay recoverable. */
const UNDO_HISTORY_LIMIT = 20;

/**
 * `Omit` over a union collapses to the keys the members share, which would hide
 * `prev` and `ids` at every call site. Distributing over the union keeps each
 * variant's own fields.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type NewUndoEntry = DistributiveOmit<UndoEntry, "at">;

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

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
  const [groupByDue, setGroupByDue] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * Bounded undo history for the batch toolbar, newest last.
   *
   * The four batch controls that commit on first click (priority, list,
   * reschedule, delete) had wildly different recoverability: delete had a
   * confirm dialog *and* an undo, while a mis-click on Reschedule over 40 tasks
   * cost 40 manual reschedules. One undoable slot fixed the worst case but not
   * the realistic one — bulk cleanup is several actions in a row, and a single
   * slot meant the second action silently threw away the first one's only way
   * back. So the history is a LIFO stack: Cmd/Ctrl+Z or the button pops the
   * newest entry, and the history menu can replay any one of them.
   */
  /**
 * The stack survives a refresh, in `sessionStorage` rather than
 * `localStorage`: an undo history is a short-lived safety net for the action you
 * just took, not a permanent record. Reloading is exactly the moment a bulk
 * mistake turns expensive — the button you mis-clicked is still sitting right
 * there under your finger — but a history that reappeared tomorrow morning would
 * be noise. `sessionStorage` outlives a refresh and dies with the tab.
 */
const UNDO_STORAGE_KEY = "taskflow:undo-stack";

/**
 * Read a persisted stack, defensively.
 *
 * This is untrusted input: it is hand-editable and survives across app versions
 * that may change the entry shape, so a malformed value has to degrade to "no
 * history" rather than throw during render and blank the dashboard. Entries are
 * filtered on the fields the replay actually reads and capped again, so neither
 * a corrupt store nor a hand-inserted 10,000-entry array can blow up the menu.
 */
function loadUndoStack(): UndoEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(UNDO_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is UndoEntry =>
          !!e &&
          typeof e === "object" &&
          (e.kind === "delete" || e.kind === "edit") &&
          typeof e.at === "number"
      )
      .slice(-UNDO_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

const [undoStack, setUndoStack] = useState<UndoEntry[]>(loadUndoStack);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoMenuOpen, setUndoMenuOpen] = useState(false);
  /**
   * Record an action. Callers must pass only the rows the server accepted, so a
   * partially failed batch contributes just its fulfilled subset.
   */
  const pushUndo = (entry: NewUndoEntry) =>
    setUndoStack((prev) =>
      [...prev, { ...entry, at: Date.now() } as UndoEntry].slice(
        -UNDO_HISTORY_LIMIT
      )
    );
  // Mirror the stack into the tab's storage. Failures are deliberately ignored:
  // a full quota or a browser with storage disabled costs the refresh-survival
  // and nothing else, since `undoStack` is still the live source of truth.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        UNDO_STORAGE_KEY,
        JSON.stringify(undoStack)
      );
    } catch {
      // ignore - undo still works for this session
    }
  }, [undoStack]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchActionNonce, setBatchActionNonce] = useState(0);
  // Bulk-tag picker. The draft is held locally so Enter can commit it without
  // the popover stealing the keystroke, and reset on close so a half-typed tag
  // never reappears on the next open.
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pendingRef = useRef<Set<string>>(new Set());
  const [pendingOps, setPendingOps] = useState<Set<string>>(new Set());
  const beginOp = (id: string) => {
    // Synchronous (ref-based) guard: two rapid clicks on the same checkbox
    // must never fire two PATCHes before the first reply lands.
    if (pendingRef.current.has(id)) return false;
    pendingRef.current.add(id);
    setPendingOps(new Set(pendingRef.current));
    return true;
  };
  const endOp = (id: string) => {
    pendingRef.current.delete(id);
    setPendingOps(new Set(pendingRef.current));
  };
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

  // Roll back only the fields this handler owns. Restoring the whole pre-batch
  // task also reverts edits the server accepted while the batch was in flight --
  // a subtask tick, a pin, a defer landing on the same row -- so a row that
  // merely failed to complete would silently lose them and disagree with the
  // server until the next refetch. This is the field scoping the single-row
  // handlers already use; a full snapshot stays correct only for a failed
  // delete, where the removed row itself is what needs restoring.
  function rollbackFields(
    previous: Map<string, Task>,
    failedIds: Set<string>,
    fields: (keyof Task)[]
  ) {
    setTasks((prev) =>
      prev.map((t) => {
        if (!failedIds.has(t.id)) return t;
        const before = previous.get(t.id);
        if (!before) return t;
        const restored: Task = { ...t };
        for (const field of fields) {
          // Assigned one key at a time through Object.assign rather than by
          // indexing `restored` directly, which TypeScript refuses for a union
          // of keys. This is a plain value copy, not a cast.
          Object.assign(restored, { [field]: before[field] });
        }
        return restored;
      })
    );
  }

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
    const succeededCount = target.length - failed.length;
    if (failed.length > 0) {
      // Only roll back the tasks that actually failed; keep the ones that
      // succeeded on the server so the UI never shows stale state.
      const failedIds = new Set(failed.map((t) => t.id));
      rollbackFields(previous, failedIds, ["completed", "completedAt"]);
      toast.error(`Failed to complete ${failed.length} of ${target.length} tasks`);
    } else {
      toast.success(`Completed ${target.length} task${target.length > 1 ? "s" : ""}`);
    }
    // Always re-fetch after recurring tasks are involved — even on partial
    // failure the server may have created next occurrences we haven't seen.
    if (hadRecurring && succeededCount > 0) {
      await refreshSilently();
      toast.success("Next occurrences scheduled for repeating tasks");
    }
    // Batch-complete is undoable, so the reverse move needs an entry too —
    // otherwise undoing a reopen was itself impossible. Rows the server
    // rejected are excluded so a replay only touches work that changed.
    if (succeededCount > 0) {
      pushUndo({
        kind: "edit",
        label: `Undo complete (${plural(succeededCount, "task")})`,
        prev: target
          .filter((_, i) => results[i].status === "fulfilled")
          .map((t) => ({
            id: t.id,
            // `completedAt` is deliberately absent: the handler derives it from
            // `completed`, so sending the old timestamp would be ignored.
            // Reopening also removes any occurrence this spawned.
            patch: { completed: false },
          })),
      });
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
    // Reopening a repeating task deletes the occurrence it spawned, and the
    // server reports those ids. The batch path used to check only the promise
    // status, so the deleted occurrences stayed rendered as phantom rows that
    // 404'd on any action.
    const removedIds = new Set<string>();
    results.forEach((r) => {
      if (r.status === "fulfilled") {
        const ids = r.value?.data?.removedNextTaskIds as string[] | undefined;
        if (Array.isArray(ids)) ids.forEach((id) => removedIds.add(id));
      }
    });
    if (removedIds.size > 0) {
      setTasks((prev) => prev.filter((t) => !removedIds.has(t.id)));
      // Prune the selection as well. The removed occurrences can well be part of
      // it -- select a daily chain together with its spawned occurrence, reopen
      // the parent, and the server deletes the child -- leaving the toolbar
      // counting tasks that no longer exist, so a batch Delete would open a
      // confirm dialog previewing more rows than it would actually trash.
      setSelectedIds((prev) =>
        new Set(Array.from(prev).filter((id) => !removedIds.has(id)))
      );
    }
    const reopened = target.filter((_, i) => results[i].status === "fulfilled");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      rollbackFields(previous, failedIds, ["completed", "completedAt"]);
      toast.error(`Failed to reopen ${failed.length} of ${target.length} tasks`);
    } else {
      toast.success(`Reopened ${target.length} task${target.length > 1 ? "s" : ""}`);
    }
    // Recorded on partial failure too. Bailing out before this left the rows the
    // server did accept with no way back, while the Undo button still labelled
    // the previous unrelated action, so pressing it undid the wrong operation.
    if (reopened.length > 0) {
      pushUndo({
        kind: "edit",
        label: `Undo reopen (${plural(reopened.length, "task")})`,
        prev: reopened.map((t) => ({
          id: t.id,
          patch: { completed: true },
        })),
      });
    }
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
    const fulfilled = target.filter((_, i) => results[i].status === "fulfilled");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      rollbackFields(previous, failedIds, ["priority"]);
      toast.error(`Failed to update priority for ${failed.length} of ${target.length} tasks`);
    } else {
      toast.success(`Priority set to ${priority} for ${target.length} task${target.length > 1 ? "s" : ""}`);
    }
    // Recorded even when the batch partly failed: those rows are persisted, and
    // returning here left them with no way back while the Undo button kept
    // pointing at the previous, unrelated action.
    if (fulfilled.length > 0) {
      // Only the rows the server actually accepted are undoable.
      pushUndo({
        kind: "edit",
        label: `Undo priority change (${plural(fulfilled.length, "task")})`,
        prev: fulfilled.map((t) => ({
          id: t.id,
          // The type marks priority optional while the schema defaults it, so an
          // absent value has to fall back to the schema default: falling back to
          // the just-written value would make the undo a silent no-op.
          patch: { priority: previous.get(t.id)?.priority ?? "medium" },
        })),
      });
    }
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
    const fulfilled = target.filter((_, i) => results[i].status === "fulfilled");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      rollbackFields(previous, failedIds, ["list"]);
      toast.error(`Failed to move ${failed.length} of ${target.length} tasks`);
    } else {
      toast.success(`Moved ${target.length} task${target.length > 1 ? "s" : ""} to "${list}"`);
    }
    // Same reasoning as batch priority: a partial failure still persisted these
    // rows, so it still needs a way back.
    if (fulfilled.length > 0) {
      pushUndo({
        kind: "edit",
        label: `Undo move (${plural(fulfilled.length, "task")})`,
        prev: fulfilled.map((t) => ({
          id: t.id,
          // Same schema-default reasoning as priority: `list` is required in the
          // type but defaults in the model.
          patch: { list: previous.get(t.id)?.list ?? "default" },
        })),
      });
    }
  };

  // Tags were the one batchable field the toolbar had no control for, even though
  // they are how every smart view is filtered: bulk-setting priority or list left
  // no way to label 40 selected tasks "#urgent" without opening 40 dialogs.
  //
  // Add and remove rather than "set", because a tag set is additive in practice:
  // the intent is "these are urgent too", not "replace every tag on these rows".
  // Both go out as one field-scoped PATCH of the resulting array, which is what
  // makes them undoable by the same mechanism as every other batch action.
  const handleBatchTag = async (rawTag: string, mode: "add" | "remove") => {
    if (selectedTasks.length === 0) return;
    // Canonicalize through the same helper the server uses, so the membership
    // test below compares against the form that would actually be stored.
    // Without this, a tag typed as "Work Later" reads as absent from a task
    // tagged "work-later" and gets appended as a second, duplicate entry.
    const tag = normalizeTags([rawTag])[0];
    if (!tag) {
      toast.error("That tag has no usable characters");
      return;
    }
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const target = selectedTasks;
    // Tasks whose tag set would not actually change, and tasks that cannot take
    // the change at all. Skipping them matters twice over: a no-op PATCH would add
    // a row to the undo history that replays into nothing, and a task already at
    // the 5-tag cap has the new tag silently dropped server-side, leaving the
    // optimistic row showing six tags until the next refetch corrected it.
    const atCap = new Set<string>();
    const changed: { id: string; next: string[] }[] = [];
    for (const t of target) {
      const current = normalizeTags(t.tags);
      const has = current.includes(tag);
      if (mode === "add") {
        if (has) continue;
        if (current.length >= 5) {
          atCap.add(t.id);
          continue;
        }
        changed.push({ id: t.id, next: [...current, tag] });
      } else {
        if (!has) continue;
        changed.push({ id: t.id, next: current.filter((x) => x !== tag) });
      }
    }
    if (changed.length === 0) {
      toast.error(
        atCap.size > 0
          ? `Every selected task already has 5 tags`
          : `No selected task ${mode === "add" ? "is missing" : "has"} #${tag}`
      );
      return;
    }
    const byId = new Map(changed.map((c) => [c.id, c.next]));
    setTasks((prev) =>
      prev.map((t) => {
        const next = byId.get(t.id);
        return next ? { ...t, tags: next } : t;
      })
    );
    const results = await Promise.allSettled(
      changed.map((c) => axios.patch(`/api/task/${c.id}`, { tags: c.next }))
    );
    const failed = changed.filter((_, i) => results[i].status === "rejected");
    const succeeded = changed.filter((_, i) => results[i].status === "fulfilled");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((c) => c.id));
      rollbackFields(previous, failedIds, ["tags"]);
      toast.error(`Failed to tag ${failed.length} of ${changed.length} task${changed.length > 1 ? "s" : ""}`);
    }
    if (succeeded.length > 0) {
      pushUndo({
        kind: "edit",
        label: `${mode === "add" ? "Undo tag" : "Undo untag"} (${plural(succeeded.length, "task")})`,
        prev: succeeded.map((c) => ({
          id: c.id,
          // `tags` replaces the whole set, so the pre-batch value is exactly what
          // restores it, and stays correct however the rows change in between.
          patch: { tags: previous.get(c.id)?.tags ?? [] },
        })),
      });
      toast.success(
        mode === "add"
          ? `Tagged ${plural(succeeded.length, "task")} #${tag}`
          : `Removed #${tag} from ${plural(succeeded.length, "task")}`
      );
    }
    // Rows skipped for the 5-tag cap are reported rather than silently ignored.
    if (atCap.size > 0) {
      toast.error(`${plural(atCap.size, "task")} skipped — already at the 5-tag limit`);
    }
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
    const succeeded = target.filter((_, i) => results[i].status === "fulfilled");
    if (failed.length > 0) {
      setTasks((prev) => [
        ...prev,
        ...failed.filter((t) => !prev.some((x) => x.id === t.id)),
      ]);
      toast.error(`Failed to move ${failed.length} task${failed.length > 1 ? "s" : ""} to trash`);
    } else {
      toast.success(`Moved ${target.length} task${target.length > 1 ? "s" : ""} to trash`);
    }
    // Track every task that was actually trashed server-side — including a
    // partial success — so nothing vanishes from both the active list and
    // the Trash view.
    if (succeeded.length > 0) {
      setTrashed((prev) => [
        ...succeeded.map((t) => ({
          ...t,
          trashed: true,
          trashedAt: new Date().toISOString(),
        })),
        ...prev,
      ]);
      pushUndo({
        kind: "delete",
        label: `Undo delete (${plural(succeeded.length, "task")})`,
        ids: succeeded.map((t) => t.id),
      });
    }
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

  /** Select or clear every task in one date group, leaving other groups alone. */
  const handleToggleGroup = (group: DueGroup) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = group.tasks.every((t) => next.has(t.id));
      group.tasks.forEach((t) =>
        allSelected ? next.delete(t.id) : next.add(t.id)
      );
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
      // Prune restored entries whose rows are gone for good. A persisted stack
      // can outlive the tasks it refers to: a task deleted on another tab, or a
      // history left behind by a different account in the same tab. Replaying
      // those would fire doomed requests and report a shortfall the user cannot
      // act on. Trashed rows are still live rows -- they are what a `delete`
      // entry restores -- so they count as present.
      const live = new Set<string>([
        ...((response.data.tasks || []) as Task[]).map((t) => t.id),
        ...((response.data.trashed || []) as Task[]).map((t) => t.id),
      ]);
      setUndoStack((prev) =>
        prev
          .map((entry) => {
            if (entry.kind === "delete") {
              const ids = entry.ids.filter((id) => live.has(id));
              if (ids.length === entry.ids.length) return entry;
              return ids.length
                ? {
                    ...entry,
                    ids,
                    label: `Undo delete (${plural(ids.length, "task")})`,
                  }
                : null;
            }
            const prev_ = entry.prev.filter((p) => live.has(p.id));
            if (prev_.length === entry.prev.length) return entry;
            return prev_.length ? { ...entry, prev: prev_ } : null;
          })
          .filter((entry): entry is UndoEntry => entry !== null)
      );
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

  // Batch selection is scoped to what's visible: when the active filter or
  // search changes, drop the selection so batch actions can never silently
  // target tasks hidden by the new view.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, search]);

  // Refs so the keydown listener below is registered exactly once: re-binding
  // on every render would churn the listener and could drop a keystroke that
  // lands mid-update.
  const undoStackRef = useRef<UndoEntry[]>([]);
  const handleUndoRef = useRef<(() => void) | null>(null);
  undoStackRef.current = undoStack;

  // Global quick-search palette (Cmd/Ctrl+K) and undo (Cmd/Ctrl+Z).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        // Never steal the browser's own text undo, and never fire from inside
        // an overlay: the search box, the subtask field and the palette input
        // all rely on Cmd+Z, and a Radix dialog/dropdown owns the keyboard
        // while it is open.
        const target = e.target as HTMLElement | null;
        const isTextField =
          !!target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable);
        const overlayOpen = !!document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]'
        );
        if (isTextField || overlayOpen) return;
        if (!undoStackRef.current.length) return;
        e.preventDefault();
        handleUndoRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [remindersSupported, setRemindersSupported] = useState(false);

  useEffect(() => {
    setRemindersSupported(
      typeof window !== "undefined" && "Notification" in window
    );
  }, []);

  // Reminders are delivered by the browser, so a fired reminder is stamped
  // server-side. The stamp is what makes delivery exactly-once: a scan finds
  // due reminders, notifies, then PATCHes `reminderFired`, and any later poll
  // (including one in a second tab) sees the stamp and stays quiet.
  const notifyDueReminders = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const due = tasks.filter(
      (t) => !t.completed && isReminderDue(t.remindAt, t.remindedAt)
    );
    for (const task of due) {
      // Stamp first: if the user closes the tab mid-request the reminder is
      // treated as delivered rather than re-firing on the next visit. The
      // remindAt that was scanned travels with the request so the server can
      // refuse to stamp a reminder that moved while this loop was awaiting an
      // earlier task — otherwise a reschedule in that window was silently
      // muted by the in-flight acknowledgement.
      let acknowledged = false;
      let serverTask: Task | null = null;
      try {
        const response = await axios.patch(`/api/task/${task.id}`, {
          reminderFired: true,
          scannedRemindAt: task.remindAt,
        });
        acknowledged = response.data?.acknowledged === true;
        serverTask = (response.data?.task as Task | undefined) ?? null;
      } catch {
        continue;
      }
      if (!acknowledged) {
        // The reminder was rescheduled mid-scan: adopt the server's copy so
        // the next poll sees the new time instead of the stale one.
        if (serverTask) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    remindAt: serverTask!.remindAt ?? null,
                    remindedAt: serverTask!.remindedAt ?? null,
                    scheduledAt: serverTask!.scheduledAt ?? t.scheduledAt,
                  }
                : t
            )
          );
        }
        continue;
      }
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                remindedAt:
                  serverTask?.remindedAt ?? new Date().toISOString(),
              }
            : t
        )
      );
      try {
        const notification = new Notification(task.title, {
          body: task.notes || task.description || "Task reminder",
          tag: `taskflow-reminder-${task.id}`,
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch {
        // Some browsers block the constructor; the stamp still prevents a
        // flood of retries.
      }
    }
  }, [tasks]);

  useEffect(() => {
    notifyDueReminders();
    const interval = setInterval(notifyDueReminders, 30000);
    // A laptop lid closing past a reminder would otherwise silently skip it
    // until the next poll, so re-scan as soon as the tab is shown again.
    const onVisible = () => {
      if (document.visibilityState === "visible") notifyDueReminders();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [notifyDueReminders]);

  const requestReminderPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("This browser cannot show notifications");
      return;
    }
    if (Notification.permission === "granted") {
      toast.success("Reminders are already enabled");
      return;
    }
    const result = await Notification.requestPermission();
    if (result === "granted") {
      toast.success("Reminders enabled");
      notifyDueReminders();
    } else {
      toast.error("Notification permission denied");
    }
  };

  const handleSetReminder = async (task: Task, remindAt: string | null) => {
    if (!beginOp(task.id)) return;
    const previousTask = tasks.find((t) => t.id === task.id) ?? task;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, remindAt, remindedAt: null }
          : t
      )
    );
    try {
      await axios.put(`/api/task/${task.id}`, { remindAt });
      toast.success(
        remindAt
          ? `Reminder set for ${reminderLabel(remindAt)}`
          : "Reminder cleared"
      );
    } catch {
      // Field-scoped rollback, like every other handler here: a whole-task
      // snapshot would revert a pin or a subtask tick the server already
      // accepted, and would reinstate a stale remindedAt that re-fires an
      // acknowledged notification.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, ...reminderFields(previousTask) }
            : t
        )
      );
      toast.error("Could not update reminder");
    } finally {
      endOp(task.id);
    }
  };

  const handleDismissReminder = async (task: Task) => {
    try {
      await axios.put(`/api/task/${task.id}`, { remindAt: null });
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, remindAt: null } : t))
      );
      toast.success("Reminder dismissed");
    } catch {
      toast.error("Could not dismiss reminder");
    }
  };

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Restored after mount, not during the first render: reading localStorage in
  // the initialiser would make the server-rendered markup disagree with the
  // client and trip React's hydration check.
  useEffect(() => {
    try {
      setGroupByDue(window.localStorage.getItem(GROUP_PREF_KEY) === "true");
    } catch {
      // Private mode or a blocked storage partition: keep the flat default.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(GROUP_PREF_KEY, String(groupByDue));
    } catch {
      // Preference simply will not persist.
    }
  }, [groupByDue]);

  const total = tasks.length;
  const completedCount = tasks.filter((t) => t.completed).length;
  const pendingCount = total - completedCount;
  const completionPct = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  const weekStart = startOfDay(addDays(new Date(), -6));
  const now = new Date();
  const completedThisWeek = tasks.filter((t) => {
    if (!t.completed || !t.completedAt) return false;
    const d = new Date(t.completedAt);
    // Bound above too: a future-dated completedAt (fast client clock or a
    // reimported backup) must not inflate the ongoing-week tally.
    return !isNaN(d.getTime()) && !isBefore(d, weekStart) && !isAfter(d, now);
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
    // A local clock read rather than the render-scope `now`: that value is a
    // new Date on every render, so depending on it would re-run this effect
    // continuously.
    const clock = new Date();
    const next7Count = tasks.filter((t) => isDueWithinDays(t, clock)).length;
    const noDueDateCount = tasks.filter((t) => !hasDueDate(t)).length;
    onStatsChange({
      today: todayCount,
      scheduled: scheduledCount,
      next7: next7Count,
      noDueDate: noDueDateCount,
      tags,
    });
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
    if (filter === "pinned") return !!t.pinned;
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
    // Smart views. Completed tasks are included exactly like "today" and
    // "scheduled" already are, so the sidebar badge and the list never disagree
    // — a badge counting only open tasks next to a list that also shows closed
    // ones is a discrepancy users read as a bug.
    if (filter === "next7") return isDueWithinDays(t, now);
    // `hasDueDate` treats an unparseable date as no date, matching how the
    // buckets below sort it.
    if (filter === "nodate") return !hasDueDate(t);
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
      (t.description || "").toLowerCase().includes(term) ||
      (t.notes || "").toLowerCase().includes(term)
    );
  });

  const trashedFiltered = trashView
    ? trashed.filter((t) =>
        term
          ? t.title.toLowerCase().includes(term) ||
            (t.description || "").toLowerCase().includes(term) ||
            (t.notes || "").toLowerCase().includes(term)
          : true
      )
    : [];

  const incomplete = filtered.filter((t) => !t.completed);
  const pinFirst = (a: Task, b: Task) =>
    Number(b.pinned ?? false) - Number(a.pinned ?? false);
  const completed = [...filtered.filter((t) => t.completed)].sort(pinFirst);

  const allShownSelected =
    filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id));
  const batchListOptions = Array.from(
    new Set<string>([
      ...listNames.map((item) => item.name),
      ...lists,
      ...customLists,
    ])
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
    const pinnedDiff = pinFirst(a, b);
    if (pinnedDiff !== 0) return pinnedDiff;
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

  // Grouped view, derived from the already-sorted list so each bucket keeps
  // the active sort. Recomputed every render on purpose: memoising on `tasks`
  // would miss the rows removed by `removedNextTaskIds` during a batch reopen.
  const dueGroups: DueGroup[] = groupTasksByDue(sortedIncomplete, now);

  const handleExport = () => {    // Export what the user is actually looking at — in the Trash view that's
    // the trashed tasks, not the active list.
    const exported = trashView ? trashedFiltered : filtered;
    if (exported.length === 0) return;
    const payload = {
      app: "TaskFlow",
      exportedAt: new Date().toISOString(),
      count: exported.length,
      tasks: exported,
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
    toast.success(`Exported ${exported.length} task${exported.length > 1 ? "s" : ""}`);
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
    : FILTERS.find((f) => f.value === filter)?.label ??
    SMART_FILTER_LABELS[filter] ??
    "All";
  const heading = trashView
    ? "Trash"
    : `${activeFilterLabel} Tasks`;

  const handleToggleComplete = async (task: Task, value: boolean) => {
    if (!beginOp(task.id)) return;
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
      const removedNextTaskIds = response.data?.removedNextTaskIds as
        | string[]
        | undefined;
      if (value && nextTask) {
        setTasks((prev) =>
          prev.some((t) => t.id === nextTask.id) ? prev : [...prev, nextTask]
        );
        toast.success("Next occurrence scheduled");
      } else if (removedNextTaskIds && removedNextTaskIds.length > 0) {
        // Undoing a completion removes the pending occurrence this task
        // spawned; drop it from the local list too so no phantom remains.
        const removed = new Set(removedNextTaskIds);
        setTasks((prev) => prev.filter((t) => !removed.has(t.id)));
      }
    } catch {
      // Roll back only the fields this handler owns (completed/completedAt) —
      // a whole-task snapshot would clobber a concurrent update (e.g. a pin
      // or subtask edit) on the same task.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                completed: previousTask.completed,
                completedAt: previousTask.completedAt,
              }
            : t
        )
      );
      toast.error("Failed to update task");
    } finally {
      endOp(task.id);
    }
  };

  const handleTogglePin = async (task: Task) => {
    if (!beginOp(task.id)) {
      toast.error("Wait for the current update to finish");
      return;
    }
    const next = !task.pinned;
    const previousTask = tasks.find((t) => t.id === task.id) ?? task;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, pinned: next } : t))
    );
    try {
      await axios.patch(`/api/task/${task.id}`, { pinned: next });
    } catch {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, pinned: previousTask.pinned } : t
        )
      );
      toast.error("Failed to update pin");
    } finally {
      endOp(task.id);
    }
  };

  const handleSnooze = async (task: Task) => {
    if (!task.recurrence || task.recurrence === "none") return;
    // The per-task pending set, not a single global slot. One slot only blocked
    // a repeat click on whichever row currently owned it, so snoozing A and
    // then B re-enabled A's button — and a second PATCH recomputed the next
    // occurrence from the date the first one had just committed, advancing the
    // chain two periods instead of one.
    if (!beginOp(task.id)) return;
    const previousTask = tasks.find((t) => t.id === task.id) ?? task;
    try {
      const response = await axios.patch(`/api/task/${task.id}`, {
        snooze: true,
      });
      const updated = response.data?.task as Task | null | undefined;
      if (updated) {
        // Write only the fields snooze owns. Spreading the whole server
        // snapshot would drop a subtask edit that was saved while this
        // request was in flight. The reminder rides along because the server
        // keeps its lead time relative to the new due date.
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  scheduledAt: updated.scheduledAt,
                  remindAt: updated.remindAt ?? null,
                  remindedAt: updated.remindedAt ?? null,
                }
              : t
          )
        );
        const rawDate = updated.scheduledAt;
        const next = rawDate ? new Date(rawDate) : new Date(NaN);
        toast.success(
          !isNaN(next.getTime())
            ? `Snoozed until ${next.toLocaleDateString()}`
            : "Snoozed to next occurrence"
        );
      }
    } catch {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                scheduledAt: previousTask.scheduledAt,
                remindAt: previousTask.remindAt ?? null,
                remindedAt: previousTask.remindedAt ?? null,
              }
            : t
        )
      );
      toast.error("Failed to snooze task");
    } finally {
      endOp(task.id);
    }
  };

  /**
   * Apply rows the server moved as a side effect of a parent edit. Rescheduling
   * a completed recurring task also rewrites its pending occurrence, and the
   * response body's `movedTasks` is the only signal the client gets — without
   * this the child row keeps its pre-move date and reminder.
   */
  const applyMovedTasks = (moved: Task[]) => {
    if (!moved.length) return;
    const byId = new Map(moved.map((t) => [t.id, dateFields(t)]));
    setTasks((prev) =>
      prev.map((t) => {
        const fields = byId.get(t.id);
        return fields ? { ...t, ...fields } : t;
      })
    );
  };

  /**
 * The day-of-month a reschedule lands on, read off the user's own calendar.
 *
 * A monthly task stores `monthlyDay` as its anchor, and the server can only
 * recover it from the instant with `new Date(...).getDate()` -- which resolves
 * in the *server's* timezone. East of UTC that is already tomorrow: moving a
 * task to the 15th at 00:00 local sends an instant that is still the 14th
 * server-side, so the anchor became 14. The due date kept rendering correctly,
 * which hid the damage until the task completed and every occurrence after it
 * spawned a day early. Sending the day explicitly is the same contract
 * `newtask` has always used.
 *
 * Only monthly tasks carry an anchor, and a cleared date has no anchor to set.
 */
function deferAnchor(task: Task, dueIso: string | null) {
  if (!dueIso || task.recurrence !== "monthly") return {};
  const day = new Date(dueIso).getDate();
  return Number.isInteger(day) ? { monthlyDay: day } : {};
}

  // Reschedule a single task. `null` clears the due date entirely.
  const handleDefer = async (task: Task, dueIso: string | null) => {
    if (!beginOp(task.id)) {
      toast.error("Wait for the current update to finish");
      return;
    }
    const previousTask = tasks.find((t) => t.id === task.id) ?? task;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, scheduledAt: dueIso ?? undefined, remindedAt: null }
          : t
      )
    );
    try {
      const response = await axios.patch(`/api/task/${task.id}`, {
        deferTo: dueIso,
        ...deferAnchor(task, dueIso),
      });
      const updated = response.data?.task as Task | null | undefined;
      if (updated) {
        // Reconcile only what this action owns, per the same rule as snooze.
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id ? { ...t, ...dateFields(updated) } : t
          )
        );
      }
      applyMovedTasks((response.data?.movedTasks as Task[]) || []);
      toast.success(dueIso ? `Moved to ${deferLabel(dueIso)}` : "Due date cleared");
    } catch {
      // Field-scoped rollback: restoring the whole task would clobber a
      // concurrent update on the same row (a pin, a subtask tick) and reinstate
      // a stale remindedAt that re-fires an acknowledged notification.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, ...dateFields(previousTask) } : t
        )
      );
      toast.error("Failed to reschedule task");
    } finally {
      endOp(task.id);
    }
  };

  const handleBatchDefer = async (dueIso: string | null) => {
    if (selectedTasks.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const target = selectedTasks;
    const ids = new Set(target.map((t) => t.id));
    setTasks((prev) =>
      prev.map((t) =>
        ids.has(t.id)
          ? { ...t, scheduledAt: dueIso ?? undefined, remindedAt: null }
          : t
      )
    );
    const results = await Promise.allSettled(
      target.map((t) =>
        axios.patch(`/api/task/${t.id}`, {
          deferTo: dueIso,
          ...deferAnchor(t, dueIso),
        })
      )
    );
    // Reconcile every success from its own response. The server owns the
    // reminder lead time and the monthly anchor, so the optimistic write left
    // rows showing a reminder chip the server had just discarded and a stale
    // day-of-month that snapped the next occurrence back.
    const applied = new Map<string, Partial<Task>>();
    const failedIds = new Set<string>();
    const moved: Task[] = [];
    let missingPayload = false;
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failedIds.add(target[i].id);
        return;
      }
      const updated = r.value?.data?.task as Task | null | undefined;
      if (updated) applied.set(target[i].id, dateFields(updated));
      else missingPayload = true;
      const sideEffects = (r.value?.data?.movedTasks as Task[]) || [];
      moved.push(...sideEffects);
    });
    setTasks((prev) =>
      prev.map((t) => {
        if (applied.has(t.id)) return { ...t, ...applied.get(t.id)! };
        const before = previous.get(t.id);
        if (failedIds.has(t.id) && before) return { ...t, ...dateFields(before) };
        return t;
      })
    );
    if (failedIds.size > 0) {
      toast.error(
        `Failed to reschedule ${failedIds.size} of ${target.length} tasks`
      );
    } else if (dueIso) {
      toast.success(
        `Moved ${target.length} task${target.length > 1 ? "s" : ""} to ${deferLabel(dueIso)}`
      );
    } else {
      toast.success(
        `Cleared due date on ${target.length} task${target.length > 1 ? "s" : ""}`
      );
    }
    // Re-fetch when a response carried no task, or a task was moved to a
    // different list by a concurrent action, so nothing is left stale.
    if (missingPayload || failedIds.size > 0) await refreshSilently();
    applyMovedTasks(moved);
    // Each row replays its OWN previous date — a shared date would collapse a
    // mixed-date selection onto one day. `deferTo: null` restores "no due
    // date". The anchor travels with it, because the server re-derives
    // `monthlyDay` from whatever date it is handed: replaying the instant
    // alone would leave the row's day-of-month disagreeing with its displayed
    // date, and the next occurrence would still spawn on the wrong day.
    // Rows the server rejected are excluded: they never changed, so replaying
    // them would only risk overwriting a concurrent edit.
    const undoable = target.filter((t) => !failedIds.has(t.id));
    if (undoable.length > 0) {
      pushUndo({
        kind: "edit",
        label: `Undo reschedule (${plural(undoable.length, "task")})`,
        prev: undoable.map((t) => {
          const was = previous.get(t.id)?.scheduledAt ?? null;
          return {
            id: t.id,
            patch: { deferTo: was, ...deferAnchor(t, was) },
          };
        }),
      });
    }
  };

  const handleSubtasks = async (task: Task, subtasks: Subtask[]) => {
    const previousTask = tasks.find((t) => t.id === task.id) ?? task;
    if (!beginOp(task.id)) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, subtasks } : t))
    );
    try {
      const response = await axios.put(`/api/task/${task.id}`, { subtasks });
      // Reconcile with the server's stored list: the API trims, dedupes
      // (case-insensitively) and caps at 100 items, so the optimistic array
      // can contain rows the server silently dropped.
      const saved = response.data?.task?.subtasks as Subtask[] | undefined;
      if (Array.isArray(saved)) {
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, subtasks: saved } : t))
        );
      }
    } catch {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, subtasks: previousTask.subtasks || [] }
            : t
        )
      );
      toast.error("Failed to update subtasks");
    } finally {
      endOp(task.id);
    }
  };

  const refreshSilently = useCallback(async () => {
    try {
      const response = await axios.get("/api/getalltasks");
      const freshTasks = response.data.tasks || [];
      const freshTrashed = response.data.trashed || [];
      setTasks(freshTasks);
      setTrashed(freshTrashed);
      // Re-sync the batch selection against the freshly fetched id set so the
      // "N selected" counter can never reference tasks that no longer exist.
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const live = new Set(freshTasks.map((t: Task) => t.id));
        return new Set(Array.from(prev).filter((id) => live.has(id)));
      });
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
      pushUndo({
        kind: "delete",
        label: "Undo delete (1 task)",
        ids: [task.id],
      });
      // Keep the batch counter honest: prune the id we just deleted.
      setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => id !== task.id)));
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

/**
   * A permanent delete invalidates any pending undo that referenced those rows,
   * so the history cannot offer to restore a task that no longer exists. Edit
   * entries are left alone: they only rewrite a field, which is still a valid
   * request for a task that no longer needs restoring.
   */
  const forgetUndoFor = (...ids: string[]) => {
    const gone = new Set(ids);
    setUndoStack((prev) =>
      prev
        .map((entry) => {
          if (entry.kind !== "delete") return entry;
          const kept = entry.ids.filter((id) => !gone.has(id));
          if (kept.length === entry.ids.length) return entry;
          return kept.length
            ? {
                ...entry,
                ids: kept,
                label: `Undo delete (${plural(kept.length, "task")})`,
              }
            : null;
        })
        .filter((entry): entry is UndoEntry => entry !== null)
    );
  };

  /**
   * Replay the chosen batch action, discarding it and anything recorded after it.
   *
   * Entries are consumed newest-first as a LIFO stack rather than
   * independently: two actions can touch the same field, so replaying an older
   * one while a newer one is still applied would restore the wrong value.
   * Dropping everything above the replayed entry is what keeps the remaining
   * history consistent with what's on screen.
   *
   * Replay is field-scoped by construction — `edit` entries carry one PATCH body
   * per row — so a concurrent pin or subtask tick on the same task survives. A
   * partial failure keeps the whole stack and refetches, since the rows that
   * failed are still the user's to retry.
   */
  const handleUndo = async (index?: number) => {
    if (undoBusy || undoStack.length === 0) return;
    const target =
      index === undefined
        ? undoStack.length - 1
        : Math.min(Math.max(index, 0), undoStack.length - 1);
    const entry = undoStack[target];
    // Consumed by identity rather than by the render-time index. The replay
    // below is awaited and the batch toolbar plus "Complete all" stay live for
    // its whole duration, so another action can be recorded while the requests
    // are in flight. Slicing at the pre-await `target` would drop that brand-new
    // entry along with the replayed one, leaving an action the user was just
    // told succeeded with no way back.
    const consumedAt = entry.at;
    const dropConsumed = (prev: UndoEntry[]) => {
      // Identity first. `at` is a millisecond timestamp, so two entries pushed
      // in the same tick are indistinguishable by it, and matching the wrong one
      // would truncate the stack at the wrong place. The live array still holds
      // this exact object; entries appended during the await are new objects
      // after it, which is exactly the boundary wanted here.
      const at = prev.indexOf(entry);
      if (at !== -1) return prev.slice(0, at);
      // Only if the entry itself was replaced mid-flight (pruned, or relabelled).
      const byAt = prev.findIndex((e) => e.at === consumedAt);
      return byAt === -1 ? prev : prev.slice(0, byAt);
    };
    setUndoBusy(true);
    try {
      const calls: { id: string; patch: Record<string, unknown> }[] =
        entry.kind === "delete"
          ? entry.ids.map((id) => ({ id, patch: { restore: true } }))
          : entry.prev;
      if (calls.length === 0) {
        // Nothing to replay: drop this entry too so the stack can't wedge.
        setUndoStack(dropConsumed);
        return;
      }
      const results = await Promise.allSettled(
        calls.map((c) => axios.patch(`/api/task/${c.id}`, c.patch))
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      // Consumed either way: the rows that succeeded are already reverted, so
      // leaving the entry would offer to replay it and revert them a second
      // time. A failure is reported rather than hidden, and the refetch below
      // shows the true state.
      setUndoStack(dropConsumed);
      if (ok < calls.length) {
        toast.error(
          `Undone ${ok} of ${calls.length} — ${calls.length - ok} could not be restored`
        );
      } else {
        toast.success(
          entry.kind === "delete"
            ? `Restored ${plural(ok, "task")}`
            : `Reverted ${plural(ok, "task")}`
        );
      }
      // Also drops rows that were trashed or removed elsewhere since the action.
      await refreshSilently();
    } catch {
      toast.error("Could not undo the last action");
    } finally {
      setUndoBusy(false);
      setUndoMenuOpen(false);
    }
  };

  // Keep the shortcut's handle current without re-binding the keydown listener.
  useEffect(() => {
    handleUndoRef.current = handleUndo;
  });

  type ImportPayload = {
    taskTitle: string;
    description: string;
    notes?: string;
    dueDate: string | null;
    list: string;
    priority: string;
    recurrence: Recurrence;
    monthlyDay?: number | null;
    tags: string[];
    subtasks?: Subtask[];
    completed?: boolean;
    completedAt?: string | null;
    pinned?: boolean;
    trashed?: boolean;
    trashedAt?: string | null;
    remindAt?: string | null;
  };

  const normalizeImportedSubtasks = (raw: unknown): Subtask[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: Subtask[] = [];
    for (const s of raw as any[]) {
      const text = typeof s?.text === "string" ? s.text.trim().slice(0, 200) : "";
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      out.push({
        id: s?.id || `${Date.now()}-${out.length}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        completed: s?.completed === true,
        createdAt: s?.createdAt,
      });
      if (out.length >= 100) break;
    }
    return out;
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
    const notes =
      typeof item.notes === "string" && item.notes.trim()
        ? item.notes.trim().slice(0, 4000)
        : "";
    const recurrence: Recurrence = isRecurrence(item.recurrence)
      ? item.recurrence
      : isRecurrence(item.repeat)
      ? item.repeat
      : "none";
    let monthlyDay: number | null = null;
    if (Number.isInteger(item.monthlyDay) && item.monthlyDay >= 1 && item.monthlyDay <= 31) {
      monthlyDay = item.monthlyDay;
    }
    // Preserve lifecycle fields on a reimport so a backup round-trip doesn't
    // resurrect completed/pinned work as brand-new open tasks.
    let completedAt: string | null = null;
    if (item.completed === true) {
      const rawCompletedAt = item.completedAt ?? null;
      if (rawCompletedAt && !isNaN(new Date(rawCompletedAt).getTime())) {
        completedAt = new Date(rawCompletedAt).toISOString();
      }
    }
    const subtasks = normalizeImportedSubtasks(item.subtasks);
    // A backup taken from the Trash view must land back in the Trash, not as a
    // fresh active duplicate. Guard the date: an invalid trashedAt would throw
    // on toISOString() and abort the whole import.
    let importedTrashedAt: string | null = null;
    if (item.trashed === true) {
      const rawTrashedAt = item.trashedAt;
      if (rawTrashedAt && !isNaN(new Date(rawTrashedAt).getTime())) {
        importedTrashedAt = new Date(rawTrashedAt).toISOString();
      }
    }
    // A reminder is an absolute instant, so it round-trips as-is. Trashed
    // tasks don't need one — the notification scan skips them anyway.
    let remindAt: string | null = null;
    if (item.remindAt && item.trashed !== true) {
      const d = new Date(item.remindAt);
      if (!isNaN(d.getTime())) remindAt = d.toISOString();
    }
    return {
      taskTitle: title,
      description,
      notes,
      dueDate,
      list,
      priority,
      recurrence,
      monthlyDay,
      tags: normalizeTags(item.tags),
      subtasks,
      completed: item.completed === true,
      completedAt: item.completed === true ? completedAt : null,
      pinned: item.pinned === true,
      trashed: item.trashed === true,
      trashedAt: importedTrashedAt,
      remindAt,
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
      if (items.length > 2000) {
        // Every task is created by its own POST, so this cap is only a guard
        // against a pathological file. It must stay above the number of tasks
        // a user can realistically export, or the app would reject its own
        // backup and they could never restore it.
        toast.error("Too many tasks (max 2000 per import)");
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
    // Operate on the visible (filtered/search) pending tasks only — never the
    // whole task list hidden behind the current filter.
    const pending = incomplete;
    if (pending.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const hadRecurring = pending.some(
      (t) => t.recurrence && t.recurrence !== "none"
    );
    const ids = new Set(pending.map((t) => t.id));
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
      pending.map((t) =>
        axios.patch(`/api/task/${t.id}`, { completed: true })
      )
    );
    const failed = pending.filter((_, i) => results[i].status === "rejected");
    const succeededCount = pending.length - failed.length;
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      rollbackFields(previous, failedIds, ["completed", "completedAt"]);
      toast.error(`Failed to complete ${failed.length} of ${pending.length} tasks`);
    } else {
      toast.success(`${pending.length} task${pending.length > 1 ? "s" : ""} completed`);
    }
    if (hadRecurring && succeededCount > 0) {
      await refreshSilently();
      toast.success("Next occurrences scheduled for repeating tasks");
    }
    // "Complete all" is the widest-reaching control in the app: one click
    // completes every open task in the current view, with no confirm dialog.
    // Rows the server rejected are excluded so a replay only touches work that
    // actually changed.
    if (succeededCount > 0) {
      pushUndo({
        kind: "edit",
        label: `Undo complete (${plural(succeededCount, "task")})`,
        prev: pending
          .filter((_, i) => results[i].status === "fulfilled")
          .map((t) => ({
            id: t.id,
            // `completed` alone: the handler derives completedAt from it,
            // and reopening also removes any occurrence this spawned.
            patch: { completed: false },
          })),
      });
    }
  };

  const handleClearCompleted = async () => {
    // Clear only the visible completed tasks (respects the active filter/search).
    const done = completed;
    if (done.length === 0) return;
    const previous = new Map(tasks.map((t) => [t.id, t]));
    const ids = new Set(done.map((t) => t.id));
    setTasks((prev) => prev.filter((t) => !ids.has(t.id)));
    // Prune the cleared ids from the batch selection too — otherwise the
    // toolbar keeps counting tasks that no longer exist, and batch Delete
    // would open a confirm dialog that silently does nothing.
    setSelectedIds((prev) =>
      new Set(Array.from(prev).filter((id) => !ids.has(id)))
    );
    const results = await Promise.allSettled(
      done.map((t) => axios.delete(`/api/task/${t.id}`))
    );
    const failed = done.filter((_, i) => results[i].status === "rejected");
    const succeeded = done.filter((_, i) => results[i].status === "fulfilled");
    if (failed.length > 0) {
      const failedIds = new Set(failed.map((t) => t.id));
      setTasks((prev) =>
        prev.map((t) => (failedIds.has(t.id) ? previous.get(t.id) ?? t : t))
      );
      toast.error(`Failed to move ${failed.length} task${failed.length > 1 ? "s" : ""} to trash`);
    } else {
      toast.success("Cleared completed tasks (moved to trash)");
    }
// Track what actually reached the trash even on partial failure.
    if (succeeded.length > 0) {
      setTrashed((prev) => [
        ...succeeded.map((t) => ({
          ...t,
          trashed: true,
          trashedAt: new Date().toISOString(),
        })),
        ...prev,
      ]);
      // Clearing completed is a bulk delete like any other, so it belongs in the
      // undo history: one mis-click can send dozens of tasks to the trash.
      pushUndo({
        kind: "delete",
        label: `Undo delete (${plural(succeeded.length, "task")})`,
        ids: succeeded.map((t) => t.id),
      });
    }
  };

  const duplicatePayload = (task: Task) => ({
    taskTitle: `${task.title} (copy)`,
    description: task.description || "",
    notes: task.notes || "",
    dueDate: task.scheduledAt || null,
    list: task.list,
    priority: task.priority || "medium",
    recurrence: task.recurrence || "none",
    tags: task.tags || [],
    subtasks: (task.subtasks || []).map((s) => ({ ...s })),
    monthlyDay: task.recurrence === "monthly" ? task.monthlyDay : undefined,
    pinned: task.pinned === true,
    // Carry the reminder, but only while it is still in the future — a copy
    // should not pop a notification for a moment that has already passed.
    remindAt:
      task.remindAt && new Date(task.remindAt).getTime() > Date.now()
        ? task.remindAt
        : null,
  });

  const handleDuplicateTask = async (task: Task) => {
    try {
      await axios.post("/api/newtask", duplicatePayload(task));
      toast.success("Task duplicated");
      await refreshSilently();
    } catch {
      toast.error("Failed to duplicate task");
    }
  };

  const handleBatchDuplicate = async () => {
    if (selectedTasks.length === 0) return;
    let ok = 0;
    let fail = 0;
    for (const task of selectedTasks) {
      try {
        await axios.post("/api/newtask", duplicatePayload(task));
        ok++;
      } catch {
        fail++;
      }
    }
    if (ok > 0) {
      toast.success(`Duplicated ${ok} task${ok > 1 ? "s" : ""}`);
      await refreshSilently();
    }
    if (fail > 0) {
      toast.error(`${fail} task${fail > 1 ? "s" : ""} could not be duplicated`);
    }
  };

  const handleRestoreTrashed = async (task: Task) => {
    try {
      await axios.patch(`/api/task/${task.id}`, { restore: true });
      setTrashed((prev) => prev.filter((t) => t.id !== task.id));
      forgetUndoFor(task.id);
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
      forgetUndoFor(task.id);
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
// Every row an undo could restore is gone, so the whole history is worthless.
    setUndoStack([]);
    toast.success("Trash emptied");
  };

  // Backups are taken from whichever list is on screen, so the same control
  // pair has to render in the Trash view too — it used to live only inside the
  // main toolbar, which the ternary never reached, making Trash unbackable.
  const importExportControls = (
    <>
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
        disabled={(trashView ? trashedFiltered : filtered).length === 0}
      >
        <Download className="mr-1.5 h-4 w-4" />
        Export
      </Button>
    </>
  );

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tasks={tasks}
        onToggleComplete={handleToggleComplete}
        onTogglePin={handleTogglePin}
        onNavigate={onFilterChange}
        onSearch={onSearchChange}
      />
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
            <div className="flex items-center gap-2">
              {importExportControls}
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBatchDuplicate}
                    disabled={selectedTasks.length === 0}
                  >
                    <Copy className="mr-1.5 h-4 w-4" />
                    Duplicate
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
                  <div className="flex items-center gap-1.5">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <Popover
                      open={tagPickerOpen}
                      onOpenChange={(o) => {
                        setTagPickerOpen(o);
                        if (!o) setTagDraft("");
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 min-w-[100px]"
                          disabled={selectedTasks.length === 0}
                          aria-label="Tag selected tasks"
                        >
                          Tags
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 p-2">
                        <div className="flex gap-1.5">
                          <Input
                            value={tagDraft}
                            placeholder="New tag"
                            className="h-8"
                            aria-label="New tag name"
                            onChange={(e) => setTagDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const tag = normalizeTags([tagDraft])[0];
                              if (!tag) return;
                              handleBatchTag(tag, "add");
                              setTagDraft("");
                            }}
                          />
                          <Button
                            size="sm"
                            className="h-8"
                            aria-label="Add this tag to selected tasks"
                            disabled={!normalizeTags([tagDraft])[0]}
                            onClick={() => {
                              const tag = normalizeTags([tagDraft])[0];
                              if (!tag) return;
                              handleBatchTag(tag, "add");
                              setTagDraft("");
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        {tagChips.length > 0 ? (
                          <div className="mt-2 max-h-56 overflow-y-auto">
                            {tagChips.map(([name, count]) => (
                              <div
                                key={name}
                                className="flex items-center justify-between gap-1 rounded px-1 py-0.5 hover:bg-accent"
                              >
                                <span className="truncate text-sm">
                                  #{name} ({count})
                                </span>
                                <span className="flex shrink-0 gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    aria-label={`Add #${name} to selected`}
                                    title={`Add #${name}`}
                                    onClick={() => handleBatchTag(name, "add")}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    aria-label={`Remove #${name} from selected`}
                                    title={`Remove #${name}`}
                                    onClick={() => handleBatchTag(name, "remove")}
                                  >
                                    <Minus className="h-3.5 w-3.5" />
                                  </Button>
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 px-1 text-xs text-muted-foreground">
                            No tags yet. Type one above.
                          </p>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    <Select
                      key={`defer-${batchActionNonce}`}
                      onValueChange={(v) => {
                        setBatchActionNonce((n) => n + 1);
                        // A batch has many different due dates, so presets
                        // resolve against today rather than any one task.
                        if (v === "none") {
                          handleBatchDefer(null);
                          return;
                        }
                        const when = resolveDeferPreset(v, null);
                        if (when) handleBatchDefer(when.toISOString());
                      }}
                    >
                      <SelectTrigger
                        className="h-8 min-w-[150px]"
                        aria-label="Reschedule selected tasks"
                      >
                        <SelectValue placeholder="Reschedule" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFER_PRESETS.filter((p) => p.id !== "none").map(
                          (preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.label}
                            </SelectItem>
                          )
                        )}
                        <SelectItem value="none">No due date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
              disabled={incomplete.length === 0}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" />
              Complete all
              <span className="ml-1 text-muted-foreground">
                ({incomplete.length})
              </span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmClear(true)}
              disabled={completed.length === 0}
              className="text-red-600 hover:text-red-600"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Clear completed
              <span className="ml-1 text-muted-foreground">
                ({completed.length})
              </span>
            </Button>
            {!trashView && (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={groupByDue ? "secondary" : "outline"}
                  onClick={() => setGroupByDue((v) => !v)}
                  aria-pressed={groupByDue}
                  title="Group open tasks into Overdue, Today, Tomorrow, This weekend, Later and No due date"
                >
                  <CalendarDays className="mr-1.5 h-4 w-4" />
                  Group by due date
                </Button>
              </div>
            )}
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
{undoStack.length > 0 ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleUndo()}
                  disabled={undoBusy}
                  className="text-emerald-600 hover:text-emerald-600"
                  // Always visible, never hover-gated: a transient control has
                  // to be discoverable at the moment it is the only way back.
                  title="Undo the last batch action (Cmd/Ctrl+Z)"
                >
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  {undoStack[undoStack.length - 1].label}
                </Button>
                {/* One slot of undo only covered the most recent action, so a
                    second batch edit silently discarded the first one's way
                    back. This lists the whole recoverable history — clicking an
                    older entry replays it and discards everything recorded after
                    it, since newer actions may have overwritten the same field. */}
                {undoStack.length > 1 ? (
                  <DropdownMenu
                    open={undoMenuOpen}
                    onOpenChange={setUndoMenuOpen}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={undoBusy}
                        className="px-2 text-emerald-600 hover:text-emerald-600"
                        aria-label={`Show undo history, ${undoStack.length} actions`}
                        title="Undo history"
                      >
                        <History className="h-4 w-4" />
                        <span className="ml-1 text-muted-foreground">
                          {undoStack.length}
                        </span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Undo history — newest first
                      </DropdownMenuLabel>
                      {[...undoStack].reverse().map((entry, i) => {
                        const index = undoStack.length - 1 - i;
                        return (
                          <DropdownMenuItem
                            key={`${entry.at}-${index}`}
                            disabled={undoBusy}
                            // Selecting an older entry replays it and drops the
                            // newer ones, so the button and the list can never
                            // disagree about what the next undo will hit.
                            onSelect={() => handleUndo(index)}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {entry.label}
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {/* The button appears only after an action, so it is announced
                    rather than silently added to the page. Kept outside the
                    button so the live region is not nested in an interactive
                    element. The button's own text is its accessible name. */}
                <span className="sr-only" role="status" aria-live="polite">
                  {undoBusy
                    ? "Undoing the last batch action"
                    : `${undoStack[undoStack.length - 1].label} is available`}
                </span>
              </>
            ) : null}
            {importExportControls}
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
                  This will move {completed.length} completed task
                  {completed.length === 1 ? "" : "s"} to Trash. You can restore
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
          {groupByDue && dueGroups.length > 0 ? (
            // Grouped by due date. Each group is its own labelled section with
            // its own dashed container, so the week reads as a shape instead
            // of one flat sorted list. The completed section below stays a
            // single hard section — grouping it would bury recently closed work
            // under date headers that no longer mean anything.
            <div className="flex flex-col gap-4">
              {dueGroups.map((group) => {
                const label = groupLabel(group.bucket);
                const headingId = `due-group-${group.bucket}`;
                const allGroupSelected = group.tasks.every((t) =>
                  selectedIds.has(t.id)
                );
                return (
                  <section
                    key={group.bucket}
                    aria-labelledby={headingId}
                    className="flex flex-col"
                  >
                    <div className="flex items-center gap-2 px-1">
                      <h2
                        id={headingId}
                        className="font-semibold text-sm text-muted-foreground"
                      >
                        {label} ({group.tasks.length})
                      </h2>
                      {/* Select mode only. Outside it the batch toolbar is not
                          rendered and the rows ignore `selected`, so a live
                          checkbox here would build a selection with no visible
                          trace — and "Select" would later reveal "3 selected"
                          over tasks the user never picked. */}
                      {edit && (
                        <Checkbox
                          checked={allGroupSelected}
                          onCheckedChange={() => handleToggleGroup(group)}
                          aria-label={`Select all ${group.tasks.length} tasks in ${label}`}
                          className="h-4 w-4"
                        />
                      )}
                    </div>
                    <div className="flex flex-col py-2 px-2 border rounded-lg border-dashed shadow-sm">
                      {group.tasks.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          edit={edit}
                          selected={selectedIds.has(task.id)}
                          onSelect={handleSelect}
                          onToggle={handleToggleComplete}
                          onTogglePin={handleTogglePin}
                          busy={pendingOps.has(task.id)}
                          onSnooze={handleSnooze}
                          onDelete={handleDelete}
                          onDuplicate={handleDuplicateTask}
                          onSubtasks={handleSubtasks}
                          onRefresh={refresh}
                          onSetReminder={handleSetReminder}
                          onDismissReminder={handleDismissReminder}
                          onEnableReminders={requestReminderPermission}
                          onDefer={handleDefer}
                          remindersSupported={remindersSupported}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              <div className="px-1">
                <AddTaskButton onTaskAdded={refresh} />
              </div>
            </div>
          ) : (
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
                    onTogglePin={handleTogglePin}
                    busy={pendingOps.has(task.id)}
                    onSnooze={handleSnooze}
                    onDelete={handleDelete}
                    onDuplicate={handleDuplicateTask}
                    onSubtasks={handleSubtasks}
                    onRefresh={refresh}
                    onSetReminder={handleSetReminder}
                    onDismissReminder={handleDismissReminder}
                    onEnableReminders={requestReminderPermission}
                    onDefer={handleDefer}
                    remindersSupported={remindersSupported}
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
          )}

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
                    onTogglePin={handleTogglePin}
                    busy={pendingOps.has(task.id)}
                    onSnooze={handleSnooze}
                    onDelete={handleDelete}
                    onDuplicate={handleDuplicateTask}
                    onSubtasks={handleSubtasks}
                    onRefresh={refresh}
                    onSetReminder={handleSetReminder}
                    onDismissReminder={handleDismissReminder}
                    onEnableReminders={requestReminderPermission}
                    onDefer={handleDefer}
                    remindersSupported={remindersSupported}
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
  busy,
  onSelect,
  onToggle,
  onTogglePin,
  onSnooze,
  onDelete,
  onDuplicate,
  onSubtasks,
  onRefresh,
  onSetReminder,
  onDismissReminder,
  onEnableReminders,
  onDefer,
  remindersSupported,
}: {
  task: Task;
  edit: boolean;
  selected: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onToggle: (task: Task, value: boolean) => void;
  onTogglePin: (task: Task) => void;
  onSnooze: (task: Task) => void;
  onDelete: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onSubtasks: (task: Task, subtasks: Subtask[]) => void;
  onRefresh: () => void;
  onSetReminder: (task: Task, remindAt: string | null) => void;
  onDismissReminder: (task: Task) => void;
  onEnableReminders: () => void;
  onDefer: (task: Task, dueIso: string | null) => void;
  remindersSupported: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [deferPickerOpen, setDeferPickerOpen] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");

  const reminderDue = isReminderDue(task.remindAt, task.remindedAt);
  // The ring stays on once a reminder has fired until it is dismissed —
  // keying it off `reminderDue` alone would make the "already notified" state
  // invisible the instant the notification appeared.
  const reminderRinging = reminderDue || !!(task.remindAt && task.remindedAt);

  const applyReminderPreset = (preset: string) => {
    if (preset === "none") {
      setReminderOpen(false);
      onDismissReminder(task);
      return;
    }
    const when = resolveReminderAt(preset, task.scheduledAt);
    if (!when) return;
    if (when.getTime() <= Date.now()) {
      // Never silently drop a preset: the user is told why and picks another.
      toast.error("That reminder time is already in the past");
      return;
    }
    onSetReminder(task, when.toISOString());
    setReminderOpen(false);
  };

  const subtasks = task.subtasks || [];
  const subtaskDone = subtasks.filter((s) => s.completed).length;

  const toggleSubtask = (id: string, completed: boolean) => {
    onSubtasks(
      task,
      subtasks.map((s) => (s.id === id ? { ...s, completed } : s))
    );
  };
  const removeSubtask = (id: string) => {
    onSubtasks(task, subtasks.filter((s) => s.id !== id));
  };
  const addSubtask = () => {
    const text = newSubtask.trim().slice(0, 200);
    if (!text) return;
    // The server caps a task at 100 subtasks and silently drops the overflow.
    // Appending optimistically anyway meant the row flashed up and then vanished
    // once the reconciled list came back, taking the typed text with it and
    // leaving no indication of why. Refuse it here with a reason, and keep the
    // text in the box so nothing is lost.
    if (subtasks.length >= 100) {
      toast.error("This task already has the maximum of 100 subtasks");
      return;
    }
    onSubtasks(task, [
      ...subtasks,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        completed: false,
      },
    ]);
    setNewSubtask("");
  };
  const addSubtaskKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSubtask();
    }
  };

  return (
    <>
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
          disabled={!edit && busy}
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
          // Hidden until hover on pointer devices only. `md:` is the first
          // breakpoint where a fine pointer is assumed, so phones and tablets
          // keep the cluster visible — @media (hover: none) never fires the
          // group-hover, which left Edit and Delete permanently invisible.
          edit ? "" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
        }`}
      >
        <button
          aria-label={task.pinned ? `Unpin ${task.title}` : `Pin ${task.title}`}
          title={task.pinned ? "Unpin task" : "Pin task"}
          onClick={() => onTogglePin(task)}
          disabled={busy}
          className={`p-1 rounded disabled:opacity-50 disabled:cursor-not-allowed ${
            task.pinned
              ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
              : "hover:bg-muted"
          }`}
        >
          <Pin className={`h-4 w-4 ${task.pinned ? "fill-amber-500" : ""}`} />
        </button>
        {!task.completed && task.recurrence && task.recurrence !== "none" && (
          <button
            aria-label={`Snooze ${task.title}`}
            title="Snooze to next occurrence (stays incomplete)"
            onClick={() => onSnooze(task)}
            disabled={busy}
            className={`p-1 hover:bg-muted rounded ${
              busy ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <TimerReset className="h-4 w-4" />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Reschedule ${task.title}`}
              title="Reschedule or clear due date"
              disabled={busy}
              className={`p-1 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted ${
                task.scheduledAt ? "" : "opacity-60"
              }`}
            >
              <CalendarClock className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Reschedule</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {DEFER_PRESETS.filter((p) => p.id !== "none").map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onSelect={() =>
                  onDefer(task, resolveDeferPreset(preset.id, task.scheduledAt)?.toISOString() ?? null)
                }
              >
                {preset.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDefer(task, null)}
              className={!task.scheduledAt ? "opacity-50" : ""}
            >
              No due date
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                // Keep the menu open: selecting an item would otherwise
                // unmount the date input before it can be used.
                e.preventDefault();
                setDeferPickerOpen(true);
              }}
            >
              Pick a date...
            </DropdownMenuItem>
            {deferPickerOpen && (
              <div
                className="p-2"
                onClick={(e) => e.stopPropagation()}
                // Radix menus own the keyboard while open and would otherwise
                // swallow the date typed here as menu typeahead.
                onKeyDown={(e) => e.stopPropagation()}
              >
                <input
                  type="date"
                  aria-label={`New due date for ${task.title}`}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    // Build the local date by hand: `new Date("YYYY-MM-DD")`
                    // parses as UTC and lands a day early west of Greenwich.
                    const [y, m, d] = e.target.value.split("-").map(Number);
                    if (!y || !m || !d) return;
                    const base = task.scheduledAt
                      ? new Date(task.scheduledAt)
                      : new Date();
                    const when = new Date(
                      y,
                      m - 1,
                      d,
                      isNaN(base.getTime()) ? 12 : base.getHours(),
                      isNaN(base.getTime()) ? 0 : base.getMinutes()
                    );
                    if (when.getTime() <= Date.now()) {
                      toast.error("Pick a date in the future");
                      return;
                    }
                    onDefer(task, when.toISOString());
                    setDeferPickerOpen(false);
                  }}
                />
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {task.notes && (
          <button
            aria-label={notesOpen ? `Hide notes for ${task.title}` : `Show notes for ${task.title}`}
            title={notesOpen ? "Hide notes" : "Show notes"}
            onClick={() => setNotesOpen((v) => !v)}
            className={`p-1 rounded ${
              notesOpen
                ? "text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950"
                : "hover:bg-muted"
            }`}
          >
            <StickyNote className="h-4 w-4" />
          </button>
        )}
        <button
          aria-label={subtasksOpen ? `Hide subtasks for ${task.title}` : `Show subtasks for ${task.title}`}
          title={subtasksOpen ? "Hide subtasks" : "Subtasks / checklist"}
          onClick={() => setSubtasksOpen((v) => !v)}
          className={`p-1 rounded ${
            subtasksOpen
              ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
              : "hover:bg-muted"
          }`}
        >
          <ListChecks className="h-4 w-4" />
        </button>
        {(task.tags || []).slice(0, 3).map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
        {task.priority && task.priority !== "medium" && (
          <PriorityChip priority={task.priority} completed={!!task.completed} />
        )}
        {task.scheduledAt && <DueLabel task={task} />}
        {task.remindAt && (
          <ReminderChip
            remindAt={task.remindAt}
            due={reminderDue}
            onDismiss={() => onDismissReminder(task)}
          />
        )}
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
        <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
          <DialogTrigger asChild>
            <button
              aria-label={
                task.remindAt
                  ? `Change reminder for ${task.title}`
                  : `Set reminder for ${task.title}`
              }
              title={task.remindAt ? "Change reminder" : "Set reminder"}
              onClick={() => {
                if (remindersSupported && Notification.permission === "default") {
                  // Ask on the first deliberate click, not on page load.
                  onEnableReminders();
                }
                setReminderOpen(true);
              }}
              className={`p-1 rounded ${
                task.remindAt
                  ? "text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950"
                  : "hover:bg-muted"
              }`}
            >
              {reminderRinging ? (
                <BellRing className="h-4 w-4" />
              ) : (
                <Bell className="h-4 w-4" />
              )}
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[360px]">
            <DialogHeader>
              <DialogTitle>Reminder</DialogTitle>
              <DialogDescription>
                {task.scheduledAt
                  ? "Reminders notify you in this browser while TaskFlow is open."
                  : "Set a due date to use relative reminders, or pick a custom time."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1">
              {REMINDER_PRESETS.filter(
                (p) => p.id !== "custom" && (p.id !== "at-time" || task.scheduledAt)
              ).map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyReminderPreset(preset.id as ReminderPresetId)}
                  disabled={preset.id !== "none" && !task.scheduledAt && preset.minutes != null}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-left hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{preset.label}</span>
                  {task.remindAt && preset.id === "at-time" ? (
                    <span className="text-xs text-muted-foreground">
                      {reminderLabel(task.remindAt)}
                    </span>
                  ) : null}
                </button>
              ))}
              <div className="mt-2 flex items-center gap-2">
                <label
                  htmlFor={`reminder-custom-${task.id}`}
                  className="text-sm text-muted-foreground"
                >
                  Custom
                </label>
                <input
                  id={`reminder-custom-${task.id}`}
                  type="datetime-local"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const when = resolveReminderAt("custom", null, e.target.value);
                    if (!when) return;
                    if (when.getTime() <= Date.now()) {
                      toast.error("That reminder time is already in the past");
                      return;
                    }
                    onSetReminder(task, when.toISOString());
                    setReminderOpen(false);
                  }}
                  className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <button
          aria-label={`Duplicate ${task.title}`}
          title="Duplicate task"
          onClick={() => onDuplicate(task)}
          className="p-1 hover:bg-muted rounded"
        >
          <Copy className="h-4 w-4" />
        </button>
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
    {task.notes && notesOpen && (
      <div className="ml-9 mb-1 border-l-2 border-sky-200 dark:border-sky-900 pl-3 text-sm text-muted-foreground whitespace-pre-wrap break-words">
        {task.notes}
      </div>
    )}
    {subtasksOpen && (
      <div className="ml-9 mb-1 border-l-2 border-emerald-200 dark:border-emerald-900 pl-3">
        <div className="flex items-center justify-between py-1">
          <span className="text-xs font-medium text-muted-foreground">
            Subtasks ({subtaskDone}/{subtasks.length})
          </span>
        </div>
        {subtasks.map((s) => (
          <div key={s.id} className="flex items-center gap-2 py-0.5 group/sub">
            <Checkbox
              checked={s.completed}
              disabled={busy}
              onCheckedChange={(v) => toggleSubtask(s.id, v === true)}
              aria-label={`Mark subtask "${s.text}" as ${s.completed ? "pending" : "done"}`}
            />
            <span
              className={`flex-1 text-sm min-w-0 break-words ${
                s.completed ? "line-through text-muted-foreground" : ""
              }`}
            >
              {s.text}
            </span>
            <button
              aria-label={`Remove subtask "${s.text}"`}
              title="Remove subtask"
              disabled={busy}
              onClick={() => removeSubtask(s.id)}
              className="rounded p-1 text-muted-foreground opacity-0 group-hover/sub:opacity-100 hover:bg-muted hover:text-red-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 py-1">
          <Input
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={addSubtaskKeyDown}
            disabled={busy}
            placeholder="Add a subtask and press Enter"
            maxLength={200}
            className="h-7 text-sm ring-inset"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !newSubtask.trim()}
            onClick={addSubtask}
          >
            Add
          </Button>
        </div>
      </div>
    )}
    </>
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

function ReminderChip({
  remindAt,
  due,
  onDismiss,
}: {
  remindAt: string;
  due: boolean;
  onDismiss: () => void;
}) {
  const when = new Date(remindAt);
  const title = isNaN(when.getTime())
    ? "Reminder"
    : `Reminds ${when.toLocaleString()}`;
  return (
    <span
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        due
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
      }`}
      title={title}
    >
      <Bell className="h-3 w-3" />
      {reminderLabel(remindAt)}
      <button
        aria-label="Dismiss reminder"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X className="h-3 w-3" />
      </button>
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
  // deferLabel carries the year-elision rule (omitted only for the current
  // year). The row chip used its own formatter and always dropped the year, so
  // a task due Jan 2027 read "Jan 5" here and "Jan 5, 2027" in the defer toast
  // and the command palette for the very same date.
  return deferLabel(date);
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