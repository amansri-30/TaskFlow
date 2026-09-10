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
import { addCustomList } from "@/lib/customLists";

export default function CreateListDialog() {
  const [listName, setListName] = useState("");

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setListName(event.target.value);
  }

  function handleCreate() {
    const result = addCustomList(listName);
    if (!result.added) {
      toast.error("List already exists or you reached the 20-list limit");
      return;
    }
    toast.success(`List "${listName.trim()}" created`);
    setListName("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreate();
    }
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
            value={listName}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Work, Health, Travel"
            maxLength={30}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Custom lists are saved on this device and appear in the sidebar and
          task forms. Delete a list by hovering it in the sidebar.
        </p>
      </div>
      <DialogFooter>
        <CustomButton type="button" className="w-full" onClick={handleCreate}>
          Create Now
        </CustomButton>
      </DialogFooter>
    </DialogContent>
  );
}