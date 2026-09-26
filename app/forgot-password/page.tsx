"use client";
import React, { useState } from "react";
import AlertBox from "@/components/elements/AlertBox";
import CustomButton from "@/components/elements/CustomButton";
import PageTemplate from "@/components/elements/PageTemplate";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import InformationCircleIcon from "@/public/svg/icons/InformationCircleIcon";
import MailSend01Icon from "@/public/svg/icons/MailSend01Icon";
import toast from "react-hot-toast";
import axios from "axios";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [alertShown, setAlertShown] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [mailOnly, setMailOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const response = await axios.post("/api/auth/forgot-password", {
        email: email.trim(),
      });
      const token = response.data?.resetToken ?? null;
      setResetToken(token);
      // A deployed build has no mail transport wired up, so the API never
      // hands the token back — it only confirms a request was accepted. Show
      // the same neutral confirmation in both cases.
      setMailOnly(!token);
      toast.success(
        token
          ? "Reset token generated successfully"
          : "If an account exists with this email, a reset link has been sent"
      );
      setAlertShown(true);
    } catch (error: any) {
      setResetToken(null);
      setMailOnly(false);
      toast.error(error?.response?.data?.message || "Something went wrong. Please try again.");
      setAlertShown(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageTemplate>
      <div className="flex items-start mt-10 mb-10 justify-center min-h-[60vh]">
        <Card className="max-w-[400px] p-4">
          <CardHeader>
            <CardTitle>Forgot Password?</CardTitle>
            <CardDescription>
              Reset password from mail sent to your registered email
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent>
              <Label className="mb-2 ml-1 block text-left">Email</Label>
              <Input
                type="email"
                name="email"
                placeholder="Enter your registered Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </CardContent>
            <CardFooter>
              <CustomButton
                rightIcon={<MailSend01Icon />}
                type="submit"
                className="w-full mt-4"
                disabled={submitting}
              >
                {submitting ? "Sending..." : "Send Reset Link"}
              </CustomButton>
            </CardFooter>
          </form>

          {alertShown && (
            <AlertBox
              alertShown={alertShown}
              title={
                mailOnly ? "Check your inbox" : "Reset Token Generated"
              }
              description={
                mailOnly
                  ? "If an account exists with that email, a reset link is on its way. This deployment has no email service configured, so a link cannot be delivered here — an administrator can enable token display for local testing."
                  : "No email service is configured, so your one-time token is shown here (valid for 60 minutes). Use it on the Reset Password page."
              }
              icon={<InformationCircleIcon />}
            />
          )}
          {resetToken && !mailOnly && (
            <div className="mt-4 grid gap-3">
              <div>
                <Label className="mb-1 block pl-1 text-left">
                  Your one-time reset token
                </Label>
                <Input
                  readOnly
                  value={resetToken}
                  className="break-all text-xs"
                  aria-label="Your one-time reset token"
                />
              </div>
              <a
                href={`/reset-password?token=${encodeURIComponent(resetToken)}`}
                className="inline-flex w-full items-center justify-center rounded-lg bg-[#16A34A] px-3 py-2 text-md font-medium leading-6 text-white shadow-md transition ease-in-out duration-500 hover:bg-black focus:outline-none focus:ring-2 focus:ring-[#16A34A]"
              >
                Continue to Reset Password
              </a>
            </div>
          )}
        </Card>
      </div>
    </PageTemplate>
  );
}
