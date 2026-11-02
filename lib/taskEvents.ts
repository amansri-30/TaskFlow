/**
 * A one-line bridge between the task list and the parts of the chrome that
 * summarise it (currently the notification bell's overdue/due-today badge).
 *
 * They are separate components with separate data, and the bell used to learn
 * about changes only from `window.focus` or from opening its popover -- so
 * ticking a task off left a stale count sitting in the header until the user
 * tabbed away and back. A window event is the smallest thing that keeps them
 * in sync without lifting all task state into a context for one number.
 */
export const TASKS_CHANGED_EVENT = "taskflow:tasks-changed";

export function notifyTasksChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}
