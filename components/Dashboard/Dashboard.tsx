"use client";
import React, { useState } from "react";
// Icon Import
import SideBar from "./SideBar/SideBar";
import TaskList from "./TaskList";
import SearchAreaWithAvatarDropdown from "./SearchAreaWithAvatarDropdown";

export type TaskStats = {
  today: number;
  scheduled: number;
};

export function Dashboard() {
  const [filter, setFilter] = useState<string>("all");
  const [stats, setStats] = useState<TaskStats>({ today: 0, scheduled: 0 });

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
        />
        {/* // dispaly task items */}
        <TaskList filter={filter} onFilterChange={setFilter} onStatsChange={setStats} />
      </div>
    </div>
  );
}