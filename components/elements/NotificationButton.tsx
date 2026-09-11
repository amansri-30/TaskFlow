"use client";
import React, { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { CalendarDays, AlertCircle, CheckCircle2 } from "lucide-react";
import axios from "axios";
import { Task } from "@/types";
import { isSameDay, startOfDay, isBefore } from "date-fns";

import NotificationSnooze01Icon from "@/public/svg/icons/NotificationSnooze01Icon";
import MessageNotification01Icon from "@/public/svg/icons/MessageNotification01Icon";

const MAX_SHOWN = 8;

export default function NotificationButton() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const response = await axios.get("/api/getalltasks");
      setTasks(response.data.tasks || []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    if (open) fetchTasks();
  }, [open]);

  const today = startOfDay(new Date());
  const dueToday = tasks.filter((t) => {
    if (t.completed || !t.scheduledAt) return false;
    const d = new Date(t.scheduledAt);
    return !isNaN(d.getTime()) && isSameDay(d, today);
  });
  const overdue = tasks.filter((t) => {
    if (t.completed || !t.scheduledAt) return false;
    const d = new Date(t.scheduledAt);
    return !isNaN(d.getTime()) && isBefore(d, today);
  });

  const alertCount = dueToday.length + overdue.length;

  const renderItem = (t: Task, isOverdue: boolean) => (
    <li
      key={t.id}
      className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
    >
      {isOverdue ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      ) : (
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{t.title}</p>
        {t.scheduledAt && (
          <p className="truncate text-xs text-muted-foreground">
            {isOverdue
              ? "Overdue"
              : new Date(t.scheduledAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
          </p>
        )}
      </div>
    </li>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative ml-auto h-8 w-8"
          aria-label={`Notifications${alertCount > 0 ? `, ${alertCount} alert(s)` : ""}`}
        >
          <MessageNotification01Icon />
          {alertCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white">
              {alertCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="font-semibold">Notifications</h1>
          <Badge variant="secondary">
            {alertCount} alert{alertCount === 1 ? "" : "s"}
          </Badge>
        </div>
        <Separator />
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading alerts...</p>
        ) : alertCount === 0 ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            <p className="text-sm text-muted-foreground">
              No new notification
            </p>
            <NotificationSnooze01Icon />
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto p-2">
            {overdue.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-red-600">
                  Overdue ({overdue.length})
                </p>
                <ul>
                  {overdue.slice(0, MAX_SHOWN).map((t) => renderItem(t, true))}
                </ul>
              </>
            )}
            {dueToday.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                  Due today ({dueToday.length})
                </p>
                <ul>
                  {dueToday.slice(0, MAX_SHOWN).map((t) => renderItem(t, false))}
                </ul>
              </>
            )}
            {alertCount > MAX_SHOWN * 2 && (
              <p className="px-2 pt-2 text-xs text-muted-foreground">
                +{alertCount - MAX_SHOWN * 2} more
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}