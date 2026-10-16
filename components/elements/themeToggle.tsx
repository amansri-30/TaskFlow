"use client";
import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import toast from "react-hot-toast";
import { ToolTipIcon } from "../elements/TootTipIcon";
import { Button } from "../ui/button";

import MoonSlowWindIcon from "@/public/svg/icons/MoonSlowWindIcon";
import Sun03Icon from "@/public/svg/icons/Sun03Icon";

const ThemeToggle = () => {
  // `theme` can be "system"; `resolvedTheme` is what is actually on screen, so
  // the icon, tooltip and toast all agree with the visible state instead of
  // promising the opposite of what the click does.
  const { resolvedTheme, setTheme } = useTheme();
  const [icon, setIcon] = useState<JSX.Element>(<Sun03Icon />);
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    setIcon(isDark ? <MoonSlowWindIcon /> : <Sun03Icon />);
  }, [isDark]);

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    setTheme(next);
    setIcon(next === "dark" ? <MoonSlowWindIcon /> : <Sun03Icon />);
    toast.success(`Switched to ${next === "dark" ? "Dark" : "Light"} Mode!`, {
      icon: next === "dark" ? "🌙" : "☀️",
      style: {
        borderRadius: "15px",
        background: "#333",
        color: "#fff",
      },
    });
  };

  return (
    <ToolTipIcon
      name={`Switch to ${isDark ? "light" : "dark"} Mode`}
      triggerJsxElement={
        <Button
          variant="outline"
          size="icon"
          className="ml-2 h-8 w-8"
          onClick={toggleTheme}
          // Radix Tooltip only attaches aria-describedby while it is open, so
          // it never supplies an accessible name: without this the control is
          // announced as an unlabelled button.
          aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        >
          {icon}
        </Button>
      }
    />
  );
};

export default ThemeToggle;