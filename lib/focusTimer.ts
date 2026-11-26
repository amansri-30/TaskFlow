/**
 * Local-only state for the dashboard focus timer. Nothing here touches the
 * server: a focus session is a personal working aid, not task data, and it must
 * keep ticking across a refresh rather than resetting when React remounts.
 */

export type FocusMode = "focus" | "break";
export type FocusTimerState = {
  mode: FocusMode;
  taskId: string | null;
  running: boolean;
  /** Absolute instant the current run ends. Ignored while paused. */
  endAt: number | null;
  /** Time left when paused, or 0 once a run has finished. */
  remainingMs: number;
};

export const FOCUS_DURATION_MS = 25 * 60_000;
export const BREAK_DURATION_MS = 5 * 60_000;

const STORAGE_KEY = "taskflow:focus-timer";

export function durationFor(mode: FocusMode): number {
  return mode === "focus" ? FOCUS_DURATION_MS : BREAK_DURATION_MS;
}

export function initialFocusTimer(): FocusTimerState {
  return {
    mode: "focus",
    taskId: null,
    running: false,
    endAt: null,
    remainingMs: FOCUS_DURATION_MS,
  };
}

function clamp(value: unknown, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(0, value))
    : max;
}

export function loadFocusTimer(): FocusTimerState {
  if (typeof window === "undefined") return initialFocusTimer();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialFocusTimer();
    const parsed = JSON.parse(raw) as Partial<FocusTimerState> | null;
    if (!parsed || typeof parsed !== "object") return initialFocusTimer();
    const mode: FocusMode = parsed.mode === "break" ? "break" : "focus";
    const duration = durationFor(mode);
    return {
      mode,
      taskId: typeof parsed.taskId === "string" ? parsed.taskId : null,
      // A timer whose stored end instant already elapsed is still "running"
      // until the component sees it and announces completion once.
      running: parsed.running === true,
      endAt:
        typeof parsed.endAt === "number" && Number.isFinite(parsed.endAt)
          ? parsed.endAt
          : null,
      remainingMs: clamp(parsed.remainingMs, duration),
    };
  } catch {
    // A corrupt or unavailable store must not break the dashboard.
    return initialFocusTimer();
  }
}

export function saveFocusTimer(state: FocusTimerState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private-mode storage failures only cost refresh survival.
  }
}

export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
