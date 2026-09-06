"use client";
import React from "react";
import { Badge } from "../../ui/badge";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "../../ui/separator";
import { Button } from "../../ui/button";
import { SideBarDataType } from "@/types";
import { TagsAccordian } from "./TagsAccordian";
import CreateListDialog from "./CreateListDialog";
import type { TaskStats } from "../Dashboard";

import AddCircleIcon from "@/public/svg/icons/AddCircleIcon";
import { cn } from "@/lib/utils";

const FILTER_BY_NAME: Record<string, string> = {
  Inbox: "all",
  Today: "today",
  Scheduled: "scheduled",
  "Filter & Label": "all",
};

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
  return (
    <>
      {/* list of inbox, today, scheduled, filter & label */}
      {SideBarList.map(({ name, icon }, id) => {
        const value = FILTER_BY_NAME[name] ?? "all";
        const count = name === "Today" ? stats.today : name === "Scheduled" ? stats.scheduled : 0;
        return (
          <button
            key={id}
            onClick={() => onSelectFilter(value)}
            aria-pressed={activeFilter === value}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              activeFilter === value && "bg-muted text-primary"
            )}
          >
            {icon} {name}
            {count > 0 ? (
              <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                {count}
              </Badge>
            ) : null}
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
          </button>
        ))}

      <Dialog>
        <DialogTrigger asChild>
          <Button className="mb-2 py-2" variant={"outline"}>
            Create Custom list <AddCircleIcon className="mx-1 w-5 h-5" />
          </Button>
        </DialogTrigger>
        <CreateListDialog />
      </Dialog>

      <Separator />

      {/* Tags Section */}
      <TagsAccordian />
    </>
  );
};