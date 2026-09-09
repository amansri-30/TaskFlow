"use client";
import { iconLinkData } from "@/lib/Data";
import React from "react";
import { ToolTipIcon } from "./TootTipIcon";
import { Separator } from "../ui/separator";
import Link from "next/link";
import { Button } from "../ui/button";
import CircleArrowUpRightIcon from "@/public/svg/icons/CircleArrowUpRightIcon";
import BuyMeACoffeeBrandLogo from "@/public/svg/icons/BuyMeACoffeeBrandLogo";

export default function FooterIconLink() {
  const BuyMeCoffeeText = [
    "Support TaskFlow ☕️",
    "Fuel Our Day 💪",
    "Recharge Us ☕️",
    "Boost Our Energy 🚀",
    "Coffee Break! ☕️",
  ];

  return (
    <div className="flex flex-col-reverse justify-center sm:flex-row sm:space-x-4 items-center w-full sm:w-auto">
      <ul className="flex gap-4">
        {iconLinkData.map((item, id) => (
          <ToolTipIcon
            key={id}
            name={item.name}
            triggerJsxElement={
              <a key={id} href={item.link}>
                {item.icon}
              </a>
            }
          />
        ))}
      </ul>

      <Separator className="sm:hidden my-3 border-[#C8C8C8] dark:bg-neutral-700" />
      <div className="flex justify-center items-center gap-2">
        <ToolTipIcon
          name="Visit our GitHub"
          triggerJsxElement={
            <Link href={"https://github.com/amansri-30/TaskFlow"}>
              <Button
                size={"sm"}
                className="portfolio-button gap-1 shadow-lg"
                variant={"outline"}
              >
                <CircleArrowUpRightIcon />
                GitHub
              </Button>
            </Link>
          }
        />
        <ToolTipIcon
          name={
            BuyMeCoffeeText[Math.floor(Math.random() * BuyMeCoffeeText.length)]
          }
          triggerJsxElement={
            <Button
              size={"sm"}
              className="buy-me-coffee-button gap-1 shadow-lg dark:hover:bg-gradient-to-r from-[#281D24] to-[#281D24]"
              variant={"outline"}
              onClick={() => window.open("/buy-a-coffee", "_self")}
            >
              <BuyMeACoffeeBrandLogo />
            </Button>
          }
        />
      </div>
    </div>
  );
}
