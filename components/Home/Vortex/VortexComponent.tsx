"use client";
import React, { useState } from "react";
import { Vortex } from "./VortexCode";
import { Input } from "@/components/ui/input";
import CustomButton from "@/components/elements/CustomButton";
import axios from "axios";
import toast from "react-hot-toast";

import MailEdit01Icon from "@/public/svg/icons/MailEdit01Icon";

export function VortexComponent() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await axios.post("/api/subscribe", { email: email.trim() });
      toast.success("You're on the waiting list!");
      setEmail("");
    } catch (error: any) {
      const already = error?.response?.status === 409;
      toast.error(
        already
          ? "You're already on the list"
          : error?.response?.data?.message || "Could not join. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-[calc(100%-0.5rem)] mx-auto rounded-md  h-[30rem] overflow-hidden">
      <Vortex
        backgroundColor="black"
        className="flex items-center flex-col justify-center px-2 md:px-10 py-4 w-full h-full"
      >
        <h2 className="text-white text-2xl md:text-6xl font-bold text-center">
          Join the Waiting List
        </h2>
        <p className="text-white text-base md:text-xl max-w-xl mt-6 text-center">
          Be the first to experience the future of task management. Sign up now
          for exclusive early access.
        </p>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col items-center w-full"
        >
          <Input
            type="email"
            name="email"
            aria-label="Email address for the waiting list"
            className="flex justify-center w-5/6 sm:w-2/6 mt-2 bg-[rgba(0,0,0,0.298)] backdrop-filter backdrop-blur-sm focus-visible:ring-0"
            placeholder="myemail@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <div className="flex sm:flex-row items-center gap-4 mt-6">
            <CustomButton
              rightIcon={<MailEdit01Icon />}
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Joining..." : "Join Now"}
            </CustomButton>
          </div>
        </form>
      </Vortex>
    </div>
  );
}
