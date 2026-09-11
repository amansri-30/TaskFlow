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
  const [noAccount, setNoAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await axios.post("/api/auth/forgot-password", { email: email.trim() });
      setNoAccount(false);
      toast.success("Reset link sent successfully");
      setAlertShown(true);
    } catch (error: any) {
      if (error?.response?.status === 404) {
        setNoAccount(true);
        toast.error("No account found with this email");
      } else {
        toast.error(error?.response?.data?.message || "Something went wrong. Please try again.");
      }
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
                noAccount
                  ? "No Account Found"
                  : "Reset Link sent Successfully"
              }
              description={
                noAccount
                  ? "We could not find an account with the email you entered. Please check the email and try again."
                  : "Open Email and click on the link to reset password"
              }
              icon={<InformationCircleIcon />}
            />
          )}
        </Card>
      </div>
    </PageTemplate>
  );
}
