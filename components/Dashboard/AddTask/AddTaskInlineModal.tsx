"use client";
import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "react-hot-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listNames } from "@/lib/Data";
import { useCustomLists } from "@/lib/customLists";
import { RECURRENCE_OPTIONS } from "@/lib/recurrence";
import { REMINDER_PRESETS, resolveReminderAt } from "@/lib/reminders";
import { normalizeTags } from "@/lib/tags";

import ArrowDown05Icon from "@/public/svg/icons/ArrowDown05Icon";
import CalendarUpload01Icon from "@/public/svg/icons/CalendarUpload01Icon";
import axios from "axios";
import { FadeDown } from "animease";

const FormSchema = z.object({
  taskTitle: z
    .string()
    .trim()
    .min(2, { message: "Task Title must be at least 2 characters." }),
  description: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  dueDate: z.date().optional(),
  list: z.string().default(""),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
  tagsText: z.string().default(""),
  reminder: z.enum([
    "none",
    "at-time",
    "10m",
    "1h",
    "3h",
    "tomorrow",
    "custom",
  ]).default("none"),
  remindAt: z.string().optional(),
});

type AddTaskInlineModalProps = {
  handleCloseModal: React.MouseEventHandler<HTMLButtonElement>;
  onTaskAdded?: () => void;
};

export function AddTaskInlineModal({
  handleCloseModal,
  onTaskAdded,
}: AddTaskInlineModalProps) {
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      taskTitle: "",
      description: "",
      notes: "",
      dueDate: undefined,
      list: "default",
      priority: "medium",
      recurrence: "none",
      tagsText: "",
      reminder: "none",
      remindAt: "",
    },
  });

  const customLists = useCustomLists();
  const listOptions = Array.from(
    new Set([...listNames.map((item) => item.name), ...customLists])
  );
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    if (submitting) return;
    const reminderAt = resolveReminderAt(
      data.reminder,
      data.dueDate ? data.dueDate.toISOString() : null,
      data.remindAt || null
    );
    // A relative reminder with no due date resolves against "now", which would
    // already be in the past and pop a notification on the next poll. Drop it
    // and say why instead of creating something the user never asked for.
    const remindAt =
      reminderAt && reminderAt.getTime() > Date.now()
        ? reminderAt.toISOString()
        : null;
    if (reminderAt && !remindAt) {
      toast.error("Reminder time is in the past — task added without it");
    }
    const formData = {
      taskTitle: data.taskTitle,
      description: data.description,
      notes: data.notes || "",
      dueDate: data.dueDate ?? null,
      list: data.list,
      priority: data.priority,
      recurrence: data.recurrence,
      tags: normalizeTags(data.tagsText),
      // Anchor monthly recurrence to the user's local calendar day rather than
      // letting the server derive it from the UTC-serialized date.
      monthlyDay:
        data.recurrence === "monthly" && data.dueDate
          ? data.dueDate.getDate()
          : undefined,
      remindAt,
    };

    setSubmitting(true);
    try {
      const response = await axios.post("/api/newtask", formData);
      toast.success(response.data.message);
      form.reset();
      onTaskAdded?.();
    } catch (error: any) {
      const message =
        error?.response?.data?.message || error?.message || "Failed to add task";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }
  

  return (
    <FadeDown variant="div"><Form {...form}>
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="w-full sm:w-2/3 space-y-3"
    >
      <div>
        <FormField
          control={form.control}
          name="taskTitle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <div className="flex items-center text-sky-600 ml-1">
                  New Task Details
                  <ArrowDown05Icon />
                </div>
              </FormLabel>
              <div>
                <FormControl>
                  <Input
                    placeholder="Task Title"
                    maxLength={120}
                    className="ring-inset rounded-bl-none rounded-br-none border-b-0"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="border- border-b-0 pl-2" />
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Textarea
                  placeholder="Description"
                  maxLength={100}
                  className="resize-none ring-inset rounded-tl-none rounded-tr-none border-dashed"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Textarea
                  placeholder="Notes (optional)"
                  maxLength={4000}
                  className="resize-none ring-inset mt-2"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tagsText"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  placeholder="Tags (comma separated, max 5) — e.g. work, urgent"
                  maxLength={100}
                  className="ring-inset mt-2"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>

      <div className="flex flex-col sm:flex-row w-full justify-between gap-2">
        <FormField
          control={form.control}
          name="dueDate"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        "min-w-[150px] pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        format(field.value, "PPP")
                      ) : (
                        <span>Pick a date</span>
                      )}
                      <CalendarUpload01Icon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) =>
                      date <
                      new Date(new Date().getTime() - 24 * 60 * 60 * 1000)
                    }
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="list"
          render={({ field }) => (
            <FormItem>
              <Select
                onValueChange={field.onChange}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className="ring-inset lg:min-w-[220px] lg:max-w-full xl:min-w-[300px]">
                    <SelectValue placeholder="Select a List" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {listOptions.map((name) => (
                    <SelectItem key={name} value={name} className="capitalize">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="priority"
          render={({ field }) => (
            <FormItem>
              <Select
                onValueChange={field.onChange}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className="ring-inset lg:min-w-[220px] lg:max-w-full xl:min-w-[300px]">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="low" className="capitalize">
                    Low
                  </SelectItem>
                  <SelectItem value="medium" className="capitalize">
                    Medium
                  </SelectItem>
                  <SelectItem value="high" className="capitalize">
                    High
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="recurrence"
          render={({ field }) => (
            <FormItem>
              <Select
                onValueChange={field.onChange}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className="ring-inset lg:min-w-[220px] lg:max-w-full xl:min-w-[300px]">
                    <SelectValue placeholder="Repeat" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {RECURRENCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="capitalize">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="reminder"
          render={({ field }) => (
            <FormItem>
              <Select
                onValueChange={field.onChange}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className="ring-inset lg:min-w-[220px] lg:max-w-full xl:min-w-[300px]">
                    <SelectValue placeholder="Reminder" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {REMINDER_PRESETS.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="remindAt"
          render={({ field }) => (
            <FormItem
              className={form.watch("reminder") === "custom" ? "" : "hidden"}
            >
              <Input
                type="datetime-local"
                value={field.value ?? ""}
                onChange={field.onChange}
                aria-label="Custom reminder time"
              />
            </FormItem>
          )}
        />
        <div className="flex space-x-2">
          <Button
            onClick={handleCloseModal}
            type="button"
            variant="destructive"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding..." : "Done"}
          </Button>
        </div>
      </div>
    </form>
  </Form></FadeDown>
  );
}
