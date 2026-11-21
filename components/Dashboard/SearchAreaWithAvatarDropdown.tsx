"use client";

import React, { useEffect, useState } from "react";
import { MobileNav } from "./SideBar/MobileSideBar";
import type { TaskStats } from "./Dashboard";
import { Bookmark, BookmarkPlus, Search, X } from "lucide-react";
import { Input } from "../ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "../ui/button";
import { useAppDispatch, useAppSelector } from "@/hooks";
import { logoutUser } from "@/redux/user/userSlice";
import { Avatar, AvatarFallback } from "../ui/avatar";
import GetQuotes from "@/middleware/getQuotes";
import toast from "react-hot-toast";

type SavedView = {
  id: string;
  label: string;
  filter: string;
  search: string;
};

const SAVED_VIEWS_KEY = "taskflow:saved-views";
const MAX_VIEWS = 12;

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_VIEWS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (view): view is SavedView =>
          !!view &&
          typeof view.id === "string" &&
          typeof view.label === "string" &&
          typeof view.filter === "string" &&
          typeof view.search === "string"
      )
      .slice(0, MAX_VIEWS);
  } catch {
    return [];
  }
}

export default function SearchAreaWithAvatarDropdown({
  activeFilter,
  onSelectFilter,
  stats,
  search,
  onSearchChange,
}: {
  activeFilter: string;
  onSelectFilter: (filter: string) => void;
  stats: TaskStats;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const user = useAppSelector((state) => state.user.user?.name);
  const [quote, setQuote] = useState<string>("");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewsLoaded, setViewsLoaded] = useState(false);
  const dispatch = useAppDispatch();

  const displayName = user?.trim() || "TaskFlow";
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    const fetchQuote = async () => {
      try {
        const fetchedQuote = await GetQuotes();
        setQuote(fetchedQuote);
      } catch (error) {
        console.error("Failed to fetch quote:", error);
      }
    };

    fetchQuote();
  }, []);

  useEffect(() => {
    setSavedViews(loadSavedViews());
    setViewsLoaded(true);
  }, []);

  useEffect(() => {
    if (!viewsLoaded) return;
    try {
      window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
    } catch {
      toast.error("Could not save views in this browser");
    }
  }, [savedViews, viewsLoaded]);

  const viewLabel =
    search.trim() ||
    (activeFilter === "all"
      ? "All tasks"
      : activeFilter.replace(/^[^:]+:\s*/, ""));

  const handleSaveView = () => {
    if (savedViews.some((view) => view.filter === activeFilter && view.search === search)) {
      toast("This view is already saved");
      return;
    }
    if (savedViews.length >= MAX_VIEWS) {
      toast.error(`You can save up to ${MAX_VIEWS} views`);
      return;
    }
    setSavedViews((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: viewLabel,
        filter: activeFilter,
        search,
      },
    ]);
    toast.success("View saved");
  };

  const handleLogout = async () => {
    // Navigate only after the server confirms it cleared the httpOnly cookie.
    // Leaving in `finally` sent the user to the home page while still signed
    // in, so the next "Login" click bounced straight back to /dashboard. On
    // failure the session is still live, so the honest state is to stay put
    // and say so.
    try {
      await dispatch(logoutUser()).unwrap();
      toast.success("Logout Successfully");
      window.location.replace("/");
    } catch (err: any) {
      const message =
        typeof err === "string" && err
          ? err
          : "Logout failed. You are still signed in.";
      toast.error(message);
    }
  };

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
      <MobileNav
        activeFilter={activeFilter}
        onSelectFilter={onSelectFilter}
        stats={stats}
      />
      <div className="w-full flex-1">
        <form onSubmit={(e) => e.preventDefault()}>
          <div className="relative flex flex-col md:flex-row items-center">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search tasks...  (#tag, list:work, p:high, is:overdue)"
              aria-label="Search tasks"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full appearance-none bg-background pl-8 shadow-none md:w-2/3 lg:w-1/3 ring-inset"
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-8 mt-1 shrink-0 gap-1 md:ml-2 md:mt-0"
                  aria-label="Saved views"
                >
                  <Bookmark className="h-4 w-4" />
                  <span className="hidden lg:inline">Views</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2">
                <div className="flex items-center justify-between gap-2 px-1 pb-2">
                  <p className="text-sm font-semibold">Saved views</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={handleSaveView}
                  >
                    <BookmarkPlus className="h-3 w-3" /> Save current
                  </Button>
                </div>
                {savedViews.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-muted-foreground">
                    Save the current filter and search to jump back here later.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {savedViews.map((view) => (
                      <li
                        key={view.id}
                        className="flex items-center gap-1 rounded-md hover:bg-muted"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                          onClick={() => {
                            onSearchChange(view.search);
                            onSelectFilter(view.filter);
                          }}
                        >
                          {view.label}
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete saved view ${view.label}`}
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setSavedViews((prev) =>
                              prev.filter((item) => item.id !== view.id)
                            )
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
            <h3 className="hidden md:block mx-auto font-semibold">
              {user ? `Welcome back, ${user}` : null}
            </h3>
            {quote ? (
              <p className="hidden md:block mx-auto font-semibold">{quote}</p>
            ) : null}
          </div>
        </form>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" className="rounded-full" aria-label="User Menu">
            <Avatar>
              <AvatarFallback className="text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* asChild makes the anchor itself the menu item. Nesting an <a> or
              <button> inside DropdownMenuItem left both mouse-only: the item
              handles Enter/Space by activating itself, and a click dispatched
              on the parent never reaches the child, so Logout could not be
              reached from the keyboard at all. */}
          <DropdownMenuItem asChild>
            <a href="/help">Support</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleLogout}>
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
