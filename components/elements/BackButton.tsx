"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";

import CircleArrowLeft01Icon from "@/public/svg/icons/CircleArrowLeft01Icon";
import { ToolTipIcon } from "./TootTipIcon";

const BackButton = () => {
  const [isMounted, setIsMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleBack = () => {
    if (isMounted) {
      router.back();
    }
  };

  if (!isMounted) return null;

  return (
    <ToolTipIcon
      name="Back"
      triggerJsxElement={
        <Button
          variant="outline"
          size="icon"
          className="ml-2 h-8 w-8"
          onClick={handleBack}
          // A Radix Tooltip only contributes aria-describedby while open, so it
          // never names the control for a screen reader.
          aria-label="Go back"
        >
          <CircleArrowLeft01Icon />
        </Button>
      }
    />
  );
};

export default BackButton;
