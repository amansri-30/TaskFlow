import { isBefore, isSameDay, startOfDay } from "date-fns";
import { Task } from "@/types";
import { dueDateOf } from "./dueGroups";

// The `is:` vocabulary shared by the main search box and the command palette.
// Both surfaces accept the same operators, so a query typed in one works
// unchanged in the other.
export const SEARCH_FLAGS = new Set([
  "overdue",
  "today",
  "scheduled",
  "nodate",
  "done",
  "open",
  "pinned",
]);

// `scheduled`/`nodate` treat an unparseable timestamp as "no date", matching
// how the sidebar's `nodate` bucket sorts it, rather than as a date in 1970.
export const matchesFlag = (task: Task, flag: string): boolean => {
  // Shared with grouping and the sidebar badges: date-only values are local
  // calendar days there, so the flag must not reinterpret them as UTC instants.
  const due = dueDateOf(task);
  switch (flag) {
    case "overdue":
      return !!due && !task.completed && isBefore(due, startOfDay(new Date()));
    case "today":
      return !!due && isSameDay(due, new Date());
    case "scheduled":
      return !!due;
    case "nodate":
      return !due;
    case "done":
      return !!task.completed;
    case "open":
      return !task.completed;
    case "pinned":
      return !!task.pinned;
    default:
      return false;
  }
};
