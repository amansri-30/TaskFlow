"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Coffee,
  History,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Trash2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { Task } from "@/types";
import {
  clearFocusSessions,
  DEFAULT_FOCUS_GOAL_MINUTES,
  durationFor,
  formatTimer,
  initialFocusTimer,
  loadFocusGoal,
  loadFocusSessions,
  loadFocusTimer,
  recordFocusSession,
  saveFocusGoal,
  saveFocusTimer,
  type FocusMode,
  type FocusSession,
  type FocusTimerState,
} from "@/lib/focusTimer";

/**
 * A small Pomodoro-style timer that lives with the task list. The absolute end
 * instant is persisted, so navigating away or refreshing does not lose a run.
 * Completion is announced once, even if the browser was closed when it elapsed.
 */
export default function FocusTimer({ tasks }: { tasks: Task[] }) {
  const [state, setState] = useState<FocusTimerState>(initialFocusTimer);
  const [now, setNow] = useState(() => Date.now());
  // Storage is read after mount so the server-rendered markup stays stable.
  // Delay persistence until that load has been applied, or the first commit
  // would briefly overwrite the saved timer with the default state.
  const [hydrated, setHydrated] = useState(false);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [goal, setGoal] = useState(DEFAULT_FOCUS_GOAL_MINUTES);
  const [logOpen, setLogOpen] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    setState(loadFocusTimer());
    setSessions(loadFocusSessions());
    setGoal(loadFocusGoal());
    setNow(Date.now());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveFocusTimer(state);
  }, [state, hydrated]);

  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [state.running]);

  const duration = durationFor(state.mode);
  const remaining =
    state.running && state.endAt !== null
      ? Math.max(0, state.endAt - now)
      : state.remainingMs;

  const announceCompletion = useCallback(() => {
    const focus = state.mode === "focus";
    setState((prev) =>
      prev.running
        ? { ...prev, running: false, endAt: null, remainingMs: 0 }
        : prev
    );
    if (focus) {
      // Record the finished round once, including rounds that elapsed while
      // the dashboard was closed: this runs on the first mount that sees them.
      setSessions(
        recordFocusSession({
          endedAt: Date.now(),
          taskId: state.taskId,
          minutes: Math.round(durationFor("focus") / 60_000),
        })
      );
    }
    const title = focus ? "Focus session complete" : "Break over";
    const task = tasks.find((t) => t.id === state.taskId);
    const body = task
      ? `${task.title} — ${focus ? "take a break" : "back to work"}`
      : focus
        ? "Take a five-minute break"
        : "Ready for another focused round?";
    toast.success(`${title}: ${body}`);
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(title, {
          body,
          tag: "taskflow-focus-timer",
        });
      } catch {
        // The toast is enough when the browser constructor is unavailable.
      }
    }
  }, [state.mode, state.taskId, tasks]);

  useEffect(() => {
    if (state.running && remaining <= 0 && !finishedRef.current) {
      finishedRef.current = true;
      announceCompletion();
    }
  }, [state.running, remaining, announceCompletion]);

  useEffect(() => {
    if (state.running && remaining > 0) finishedRef.current = false;
  }, [state.running, remaining]);

  const start = () => {
    finishedRef.current = false;
    const startedAt = Date.now();
    // A finished timer starts a fresh round rather than restarting at zero.
    const base = state.remainingMs > 0 ? state.remainingMs : duration;
    setNow(startedAt);
    setState((prev) => ({
      ...prev,
      running: true,
      endAt: startedAt + base,
      remainingMs: base,
    }));
  };

  const pause = () => {
    setState((prev) => {
      if (!prev.running) return prev;
      return {
        ...prev,
        running: false,
        endAt: null,
        remainingMs: Math.max(0, (prev.endAt ?? Date.now()) - Date.now()),
      };
    });
  };

  const reset = () => {
    finishedRef.current = false;
    setState((prev) => ({
      ...prev,
      running: false,
      endAt: null,
      remainingMs: durationFor(prev.mode),
    }));
  };

  const switchMode = (mode: FocusMode) => {
    finishedRef.current = false;
    setState((prev) => ({
      ...prev,
      mode,
      running: false,
      endAt: null,
      remainingMs: durationFor(mode),
    }));
  };

  const selectTask = (taskId: string) =>
    setState((prev) => ({ ...prev, taskId: taskId || null }));

  const selectedTask = tasks.find((t) => t.id === state.taskId);
  const taskOptions = useMemo(() => {
    const open = tasks.filter((t) => !t.completed);
    // A task may have been completed while its timer was selected; keep it in
    // the dropdown until the user switches away so the label stays explainable.
    return selectedTask && !open.some((t) => t.id === selectedTask.id)
      ? [selectedTask, ...open]
      : open;
  }, [tasks, selectedTask]);
  const progress = Math.min(100, Math.max(0, ((duration - remaining) / duration) * 100));
  const todayLabel = new Date().toDateString();
  const todaySessions = sessions.filter(
    (session) => new Date(session.endedAt).toDateString() === todayLabel
  );
  const todayMinutes = todaySessions.reduce((sum, s) => sum + s.minutes, 0);
  const goalProgress = Math.min(100, Math.round((todayMinutes / goal) * 100));
  const taskSessions = state.taskId
    ? sessions.filter((session) => session.taskId === state.taskId)
    : [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Focus timer, ${formatTimer(remaining)} remaining`}
          title="Focus timer"
        >
          <Timer className="mr-1.5 h-4 w-4" />
          {state.running ? formatTimer(remaining) : "Focus"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Focus timer</h2>
          <span className="text-xs text-muted-foreground">
            {state.mode === "focus" ? "25 min session" : "5 min break"}
          </span>
        </div>

        <select
          value={selectedTask ? selectedTask.id : ""}
          onChange={(e) => selectTask(e.target.value)}
          aria-label="Task for this focus session"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">No task selected</option>
          {taskOptions.slice(0, 50).map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>

        <div className="flex gap-1 rounded-md bg-muted p-1 text-xs">
          {(["focus", "break"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              className={`flex-1 rounded px-2 py-1 capitalize ${
                state.mode === mode ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              {mode === "focus" ? "Focus" : "Break"}
            </button>
          ))}
        </div>

        <div className="text-center">
          <p
            className="font-mono text-3xl font-semibold tabular-nums"
            role="timer"
            aria-live="off"
          >
            {formatTimer(remaining)}
          </p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={state.running ? pause : start}
          >
            {state.running ? (
              <>
                <Pause className="mr-1.5 h-4 w-4" /> Pause
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-4 w-4" /> Start
              </>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={reset} title="Reset timer">
            <RotateCcw className="h-4 w-4" />
            <span className="sr-only">Reset timer</span>
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Coffee className="h-3.5 w-3.5 shrink-0" />
          Keeps running in the background, even after a refresh.
        </p>

        <div className="space-y-2 border-t pt-2">
          <button
            type="button"
            className="flex w-full items-center justify-between text-xs font-medium"
            aria-expanded={logOpen}
            onClick={() => setLogOpen((open) => !open)}
          >
            <span className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" /> Focus log
            </span>
            <span className="text-muted-foreground">
              Today: {todaySessions.length} &middot; {todayMinutes}/{goal} min
            </span>
          </button>
          {selectedTask && taskSessions.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              {selectedTask.title}: {taskSessions.length} session
              {taskSessions.length === 1 ? "" : "s"} &middot;{" "}
              {taskSessions.reduce((sum, s) => sum + s.minutes, 0)} min
            </p>
          )}
          {logOpen && (
            <div className="space-y-1.5">
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Daily focus goal</span>
                  <span>{goalProgress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                    style={{ width: `${goalProgress}%` }}
                  />
                </div>
              </div>
              <label className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Goal (minutes)</span>
                <input
                  type="number"
                  min={5}
                  max={480}
                  value={goal}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    const clamped = Math.min(480, Math.max(5, Math.round(next)));
                    setGoal(clamped);
                    saveFocusGoal(clamped);
                  }}
                  aria-label="Daily focus goal in minutes"
                  className="w-20 rounded-md border bg-background px-2 py-1 text-right"
                />
              </label>
              {sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No finished focus sessions yet.
                </p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                  {sessions
                    .slice(-5)
                    .reverse()
                    .map((session, index) => {
                      const task = tasks.find((t) => t.id === session.taskId);
                      return (
                        <li
                          key={`${session.endedAt}-${index}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {task?.title || "No task"}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {session.minutes}m &middot;{" "}
                            {new Date(session.endedAt).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" }
                            )}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )}
              {sessions.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-full justify-start px-0 text-xs text-muted-foreground"
                  onClick={() => {
                    clearFocusSessions();
                    setSessions([]);
                  }}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear history
                </Button>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
