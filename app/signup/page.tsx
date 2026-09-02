"use client";
import React, { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { generatePassword } from "@/lib/GeneratePassword";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import SecurityPasswordIcon from "@/public/svg/icons/SecurityPasswordIcon";
import PageTemplate from "@/components/elements/PageTemplate";
import AlertBox from "@/components/elements/AlertBox";
import { useAppDispatch, useAppSelector } from "@/hooks";
import { registerUser } from "@/redux/user/userSlice";

export default function SignUp() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [alertShown, setAlertShown] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const dispatch = useAppDispatch();
  const router = useRouter();
  const isAuthenticated = useAppSelector((state) => state.user?.isAuthenticated);
  const error = useAppSelector((state) => state.user?.error);
  const isLoading = useAppSelector((state) => state.user?.isLoading);

  useEffect(() => {
    if (isAuthenticated) {
      router.push("/dashboard");
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleGeneratePassword = () => {
    const newPassword = generatePassword();
    setPassword(newPassword);
    setAlertShown(true);
  };

  const SignUpHandler = async (e: FormEvent) => {
    e.preventDefault();
    dispatch(registerUser({ name: `${firstName} ${lastName}`, email, password }));
  };

  return (
    <PageTemplate>
      <div className="flex flex-col items-center justify-center min-h-[80vh] mb-8">
        <h1 className="flex justify-center items-center mb-2 font-semibold text-3xl">
          Welcome to TaskFlow
        </h1>
        <Card className="max-w-sm w-full">
          <CardHeader>
            <CardTitle className="text-xl">Sign Up</CardTitle>
            <CardDescription>
              Enter your information to create an account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={SignUpHandler} className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="first-name">First name</Label>
                  <Input
                    onChange={(e) => setFirstName(e.target.value)}
                    value={firstName}
                    id="first-name"
                    placeholder="Rishabh"
                    required
                    autoComplete="given-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="last-name">Last name</Label>
                  <Input
                    onChange={(e) => setLastName(e.target.value)}
                    value={lastName}
                    id="last-name"
                    placeholder="Gokhe"
                    required
                    autoComplete="family-name"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email" className="text-start">
                  Email
                </Label>
                <Input
                  onChange={(e) => setEmail(e.target.value)}
                  value={email}
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password" className="text-start">
                  Password
                </Label>
                <Input
                  onChange={(e) => setPassword(e.target.value)}
                  value={password}
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="flex justify-between">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="showPassword"
                    checked={showPassword}
                    onChange={() => setShowPassword(!showPassword)}
                    className="form-checkbox cursor-pointer h-4 w-4 text-blue-600 transition duration-150 ease-in-out"
                    aria-describedby="show-password-label"
                  />
                  <Label
                    htmlFor="showPassword"
                    id="show-password-label"
                    className="ml-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer"
                  >
                    Show Password
                  </Label>
                </div>
                <Badge
                  onClick={handleGeneratePassword}
                  className="cursor-pointer"
                  variant={"outline"}
                >
                  Generate Password
                </Badge>
              </div>

              <AlertBox
                alertShown={alertShown}
                title="Suggestion"
                description="Save your password to a password manager or note it down!"
                icon={
                  <SecurityPasswordIcon
                    className={`text-red-500 h-6 w-6 mr-2`}
                  />
                }
              />

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating account..." : "Create an account"}
              </Button>
            </form>
            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <Link href="/login" className="underline">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageTemplate>
  );
}
