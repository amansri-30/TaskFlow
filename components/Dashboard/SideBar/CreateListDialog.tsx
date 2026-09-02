"use client";
import CustomButton from "@/components/elements/CustomButton";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import React, { useState } from "react";
import toast from "react-hot-toast";

type CustomList = {
  name: string;
  link: string;
  icon: JSX.Element;
};

export default function CreateListDialog({ onListCreated }: { onListCreated?: (list: CustomList) => void }) {
  const [list, setList] = useState("");

  function handleClick() {
    if (!list.trim()) {
      toast.error("List name is required");
      return;
    }
    const newList: CustomList = {
      name: list.trim(),
      link: `/list/${list.trim().toLowerCase()}`,
      icon: <div className="w-5 h-5" />,
    };
    onListCreated?.(newList);
    toast.success(`List "${newList.name}" created`);
    setList("");
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setList(event.target.value);
  }

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Create List</DialogTitle>
        <DialogDescription>
          Create your own custom list for organizing tasks
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="items-center gap-4">
          <Label htmlFor="list-name" className="pl-1 text-right">
            Name
          </Label>
          <Input
            id="list-name"
            className="ring-inset"
            value={list}
            onChange={handleChange}
            placeholder="e.g. Work, Health, Travel"
          />
        </div>
      </div>
      <DialogFooter>
        <CustomButton type="button" className="w-full" onClick={handleClick}>
          Create Now
        </CustomButton>
      </DialogFooter>
    </DialogContent>
  );
}
