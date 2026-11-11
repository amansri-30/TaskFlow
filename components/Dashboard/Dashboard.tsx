"use client";
import React, { useState } from "react";
// Icon Import
import SideBar from "./SideBar/SideBar";
import TaskList from "./TaskList";
import SearchAreaWithAvatarDropdown from "./SearchAreaWithAvatarDropdown";

export type TagStat = { name: string; count: number };

export type TaskStats = {
  today: number;
  scheduled: number;
  next7: number;
  noDueDate: number;
  tags: TagStat[];
  /**
   * Task count keyed by the exact stored list name, so the sidebar badge and
   * the `list:<name>` filter (which compares with `===`) can never disagree.
   * Completed tasks are included for the same reason they are in the other
   * buckets: the list view shows them too.
   */
  lists: Record<string, number>;
};

export function Dashboard() {
  const [filter, setFilter] = useState<string>("all");
  const [stats, setStats] = useState<TaskStats>({
    today: 0,
    scheduled: 0,
    next7: 0,
    noDueDate: 0,
    tags: [],
    lists: {},
  });
  const [search, setSearch] = useState<string>("");

  return (
    // Side Bar Todo List
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <SideBar
        activeFilter={filter}
        onSelectFilter={setFilter}
        stats={stats}
      />
      <div className="flex flex-col">
        {/* // Search bar with account avatar dropdown menu */}
        <SearchAreaWithAvatarDropdown
          activeFilter={filter}
          onSelectFilter={setFilter}
          stats={stats}
          search={search}
          onSearchChange={setSearch}
        />
        {/* // dispaly task items */}
        <TaskList
          filter={filter}
          onFilterChange={setFilter}
          onStatsChange={setStats}
          search={search}
          onSearchChange={setSearch}
        />
      </div>
    </div>
  );
}