import { ReactNode } from "react";
import type { Recurrence } from "@/lib/recurrence";

export type User = {
  _id: string;
  name: string;
  email: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
};


export type AnimationData = {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: number;
  assets: any[];
  layers: any[];
};

export type Task = {
  id: string;
  _id?: string;
  title: string;
  description?: string;
  notes?: string;
  list: string;
  priority?: "low" | "medium" | "high";
  date?: string;
  scheduledAt?: string;
  completed?: boolean;
  completedAt?: string | null;
  recurrence?: Recurrence;
  monthlyDay?: number;
  tags?: string[];
  pinned?: boolean;
  trashed?: boolean;
  trashedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type SideBarDataType = {
  name: string;
  link: string | { url: string; target?: string };
  icon: ReactNode;
};
