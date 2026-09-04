import React, { useState } from "react";
import { SelectSingleEventHandler } from "react-day-picker";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listNames } from "@/lib/Data";
import { Task } from "@/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import axios from "axios";
import toast from "react-hot-toast";

import SearchList02Icon from "@/public/svg/icons/SearchList02Icon";
import Calendar02Icon from "@/public/svg/icons/Calendar02Icon";
import CalendarUpload01Icon from "@/public/svg/icons/CalendarUpload01Icon";

export function EditTaskDialogContent({
  task,
  onSaved,
}: {
  task: Task;
  onSaved?: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [list, setList] = useState(task.list);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    const raw = task.scheduledAt ?? task.date;
    if (!raw) return undefined;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? undefined : d;
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleDateSelected: SelectSingleEventHandler = (date) => {
    if (date instanceof Date && !isNaN(date.getTime())) {
      setSelectedDate(date);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setIsSaving(true);
    try {
      await axios.put(`/api/task/${task.id}`, {
        taskTitle: title,
        description,
        list,
        dueDate: selectedDate?.toISOString(),
      });
      toast.success("Task updated successfully");
      onSaved?.();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update task");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Edit task</DialogTitle>
        <DialogDescription>Make changes to your tasks here.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="items-center gap-4">
          <Label htmlFor="title" className="pl-1 text-right">
            Title
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="ring-inset"
          />
        </div>

        <div className="items-center gap-4">
          <Label htmlFor="description" className="pl-1 text-right">
            Description
          </Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="line-clamp-3 ring-inset"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex justify-center items-center gap-1">
            <SearchList02Icon />
            <Label htmlFor="list" className="text-right">
              List
            </Label>
          </div>
          <Select value={list} onValueChange={setList}>
            <SelectTrigger className="ring-inset min-w-[150px]">
              <SelectValue placeholder={task.list} />
            </SelectTrigger>
            <SelectContent>
              {listNames.map((item, id) => (
                <SelectItem key={id} value={item.name}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex justify-center items-center gap-1">
            <Calendar02Icon />
            <Label htmlFor="date" className="text-right">
              Date
            </Label>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "min-w-[150px] pl-3 text-left font-normal text-muted-foreground"
                )}
              >
                {selectedDate ? format(selectedDate, "PPP") : "Select date"}
                <CalendarUpload01Icon className="ml-2 h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={handleDateSelected}
                disabled={(date) =>
                  date < new Date(new Date().getTime() - 24 * 60 * 60 * 1000)
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
