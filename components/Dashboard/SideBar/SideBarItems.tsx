"use client";
import React, { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "../../ui/badge";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "../../ui/separator";
import { Button } from "../../ui/button";
import { SideBarDataType } from "@/types";
import { TagsAccordian } from "./TagsAccordian";
import CreateListDialog from "./CreateListDialog";
import type { TaskStats } from "../Dashboard";
import { useCustomLists, removeCustomList } from "@/lib/customLists";

import AddCircleIcon from "@/public/svg/icons/AddCircleIcon";
import { cn } from "@/lib/utils";

const FILTER_BY_NAME: Record<string, string> = {
  Inbox: "all",
  Today: "today",
  Overdue: "overdue",
  Scheduled: "scheduled",
  "Next 7 days": "next7",
  "No due date": "nodate",
  "Filter & Label": "all",
  Trash: "trash",
  Pinned: "pinned",
};

// `min-w-6` rather than a fixed `w-6`: a fixed square clipped once a bucket
// passed two digits, and three-digit totals are normal in a long-running
// account. `ml-auto` pushes the count to the row's trailing edge.
function SidebarCount({
  count,
  destructive,
}: {
  count: number;
  destructive?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <Badge
      className={cn(
        "ml-auto flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5",
        // Overdue is the one count that asks for action rather than reporting
        // state, so it carries the same red the popover uses for overdue rows.
        destructive && "bg-red-600 text-white hover:bg-red-600 dark:bg-red-500"
      )}
    >
      {count}
    </Badge>
  );
}

export const SideBarItems = ({
  SideBarList,
  listNames,
  activeFilter,
  onSelectFilter,
  stats,
}: {
  SideBarList: SideBarDataType[];
  listNames: SideBarDataType[];
  activeFilter: string;
  onSelectFilter: (filter: string) => void;
  stats: TaskStats;
}) => {
  const customLists = useCustomLists();
  // Controlled so the create dialog can close itself after a successful save.
  // Uncontrolled, it stayed open on an emptied form and the new list appeared
  // behind the modal, which read as the create having done nothing.
  const [createListOpen, setCreateListOpen] = useState(false);

  return (
    <>
      {/* list of inbox, today, scheduled, filter & label */}
      {SideBarList.map(({ name, icon }, id) => {
        const value = FILTER_BY_NAME[name] ?? "all";
        // "Filter & Label" is a section heading here, not a filter — sharing
        // the "all" value with Inbox would double-highlight both on load.
        const isHeading = name === "Filter & Label";
        const isOverdue = name === "Overdue";
        const count =
          name === "Today"
            ? stats.today
            : name === "Overdue"
            ? stats.overdue
            : name === "Scheduled"
            ? stats.scheduled
            : name === "Next 7 days"
            ? stats.next7
            : name === "No due date"
            ? stats.noDueDate
            : 0;
        return (
          <button
            key={id}
            onClick={() => {
              if (!isHeading) onSelectFilter(value);
            }}
            aria-pressed={isHeading ? undefined : activeFilter === value}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all",
              isHeading
                ? "font-semibold text-muted-foreground cursor-default"
                : "hover:text-primary",
              !isHeading && isOverdue && count > 0 && "text-red-600 dark:text-red-400",
              !isHeading && activeFilter === value && "bg-muted text-primary"
            )}
          >
            {icon} {name}
            <SidebarCount count={count} destructive={isOverdue} />
          </button>
        );
      })}
      <Separator />

      {/* List: Default Section */}
      <button
        onClick={() => onSelectFilter(`list:${listNames[0].name}`)}
        aria-pressed={activeFilter === `list:${listNames[0].name}`}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary border my-2",
          activeFilter === `list:${listNames[0].name}` && "bg-muted text-primary"
        )}
      >
        {listNames[0].icon} {listNames[0].name}
        <SidebarCount count={stats.lists[listNames[0].name] ?? 0} />
      </button>

      <Separator />

      {/* Custom List Section */}
      <h2 className="px-2 pt-2 text-xl">Custom List</h2>
      {listNames
        .filter((_, id) => id !== 0)
        .map(({ name, icon }, id) => (
          <button
            key={id}
            onClick={() => onSelectFilter(`list:${name}`)}
            aria-pressed={activeFilter === `list:${name}`}
            className={cn(
              "capitalize flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              activeFilter === `list:${name}` && "bg-muted text-primary"
            )}
          >
            {icon} {name}
            <SidebarCount count={stats.lists[name] ?? 0} />
          </button>
        ))}

      {customLists.map((name) => (
        <div
          key={name}
          className="flex items-center rounded-lg transition-colors group"
        >
          <button
            onClick={() => onSelectFilter(`list:${name}`)}
            aria-pressed={activeFilter === `list:${name}`}
            className={cn(
              "flex flex-1 items-center gap-3 rounded-lg px-3 py-2 capitalize transition-all hover:text-primary",
              activeFilter === `list:${name}` && "bg-muted text-primary"
            )}
          >
            {name}
            <SidebarCount count={stats.lists[name] ?? 0} />
          </button>
          <button
            aria-label={`Delete list ${name}`}
            title={`Delete list ${name}`}
            onClick={() => {
              removeCustomList(name);
              if (activeFilter === `list:${name}`) onSelectFilter("all");
            }}
            // `hidden` is display:none, which also took the button out of the
            // tab order: deleting a list required a mouse hover, so keyboard
            // users could create a list but never remove it, and touch screens
            // (no hover) never revealed it at all. Opacity keeps it focusable
            // while still staying out of the way until the row is hovered or
            // one of its controls has focus.
            className="mr-1 p-1 text-muted-foreground opacity-100 transition-opacity hover:text-red-600 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <Dialog open={createListOpen} onOpenChange={setCreateListOpen}>
        <DialogTrigger asChild>
          <Button className="mb-2 py-2" variant={"outline"}>
            Create Custom list <AddCircleIcon className="mx-1 w-5 h-5" />
          </Button>
        </DialogTrigger>
        <CreateListDialog onCreated={() => setCreateListOpen(false)} />
      </Dialog>

      <Separator />

      {/* Tags Section */}
      <TagsAccordian
        tags={stats.tags}
        activeTag={
          activeFilter.startsWith("tag:") ? activeFilter.slice("tag:".length) : null
        }
        onTagClick={(tag) => {
          const target = `tag:${tag}`;
          onSelectFilter(activeFilter === target ? "all" : target);
        }}
      />
    </>
  );
};