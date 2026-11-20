"use client";
import React, { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Bell, Flower, Menu } from "lucide-react";
import { Button } from "../../ui/button";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../ui/card";
import { Badge } from "../../ui/badge";
import { SideBarList, listNames } from "@/lib/Data";

import { SideBarItems } from "./SideBarItems";
import ThemeToggle from "@/components/elements/themeToggle";
import NotificationButton from "@/components/elements/NotificationButton";
import ImportantLinks from "./ImportantLinks";
import type { TaskStats } from "../Dashboard";

export const MobileNav = ({
  activeFilter,
  onSelectFilter,
  stats,
}: {
  activeFilter: string;
  onSelectFilter: (filter: string) => void;
  stats: TaskStats;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="shrink-0 md:hidden">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex flex-col overflow-y-auto">
          <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Flower className="h-6 w-6" />
              <span className="">TaskFlow</span>
            </Link>
            <NotificationButton />
            <ThemeToggle />
          </div>
          <nav className="grid gap-1 text-lg font-medium">
            <SideBarItems
              SideBarList={SideBarList}
              listNames={listNames}
              activeFilter={activeFilter}
              // The sheet is a modal overlay. Leaving it open after a filter
              // tap kept the list hidden behind it, so the user had to dismiss
              // the menu a second time before seeing the view they selected.
              onSelectFilter={(filter) => {
                onSelectFilter(filter);
                setOpen(false);
              }}
              stats={stats}
            />
          </nav>
          <ImportantLinks />
        </SheetContent>
      </Sheet>
    </>
  );
};