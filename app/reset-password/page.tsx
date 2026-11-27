"use client";
import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import axios from "axios";
import PageTemplate from "@/components/elements/PageTemplate";
import CustomButton from "@/components/elements/CustomButton";
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
import { LockKeyhole } from "lucide-react";
import { passwordPolicyError } from "@/lib/passwordPolicy";

function ResetPasswordForm() {
  const router = useRouter();
  // The App Router reuses this page when only the query string changes, so a
  // mount-only window.location read left a second reset link showing the first
  // token. useSearchParams tracks client navigations and history entries.
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = searchParams?.get("token");
    if (t) setToken(t);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Shared with the reset API and the signup form. `minLength={10}` alone
    // misses byte-heavy passwords that bcrypt would silently truncate.
    const policyError = passwordPolicyError(password);
    if (policyError) {
      toast.error(policyError);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await axios.post("/api/auth/reset-password", { token: token.trim(), password });
      toast.success("Password reset successfully");
      router.push("/login");
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          "Reset failed. Make sure the token is valid and not expired."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageTemplate>
      <div className="flex items-start mt-10 mb-10 justify-center min-h-[60vh]">
        <Card className="max-w-[400px] p-4">
          <CardHeader>
            <CardTitle>Reset Password</CardTitle>
            <CardDescription>
              Enter the one-time token you received and choose a new password.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="grid gap-3">
              <div>
                <Label className="mb-2 ml-1 block text-left">Reset token</Label>
                <Input
                  name="token"
                  placeholder="Paste your reset token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label className="mb-2 ml-1 block text-left">New password</Label>
                <Input
                  type="password"
                  name="password"
                  placeholder="At least 10 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={10}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label className="mb-2 ml-1 block text-left">Confirm password</Label>
                <Input
                  type="password"
                  name="confirm"
                  placeholder="Re-enter new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={10}
                  autoComplete="new-password"
                />
              </div>
            </CardContent>
            <CardFooter>
              <CustomButton
                rightIcon={<LockKeyhole className="h-4 w-4" />}
                type="submit"
                className="w-full mt-4"
                disabled={submitting}
              >
                {submitting ? "Resetting..." : "Reset Password"}
              </CustomButton>
            </CardFooter>
          </form>
        </Card>
      </div>
    </PageTemplate>
  );
}

// useSearchParams requires a Suspense boundary when this route is prerendered.
export default function ResetPassword() {
  return (
    <Suspense
      fallback={
        <PageTemplate>
          <div className="min-h-[60vh]" aria-label="Loading reset form" />
        </PageTemplate>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}