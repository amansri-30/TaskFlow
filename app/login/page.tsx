"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import PageTemplate from "@/components/elements/PageTemplate";
import { useAppDispatch, useAppSelector } from "@/hooks";
import { loginUser } from "@/redux/user/userSlice";

export default function LoginForm() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const userId = useAppSelector(state => state.user.user?._id);
  const isLoading = useAppSelector(state => state.user.isLoading);

  useEffect(() => {
    if (userId) {
      router.push("/dashboard");
    }
  }, [userId, router]);

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    dispatch(loginUser({ email, password }));
  };

  return (
    <PageTemplate>
      <div className="flex items-center justify-center min-h-[80vh]">
        <Card className="mx-auto max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Login</CardTitle>
            <CardDescription>
              Enter your email below to login to your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin}>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email" className="text-left">
                    Email
                  </Label>
                  <Input
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                    id="email"
                    type="email"
                    placeholder="myemail@example.com"
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="ml-auto inline-block text-sm underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <Input
                  onChange={(e) => setPassword(e.target.value)}
                  value={password}
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                />

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

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Logging in..." : "Login"}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="underline">
                  Sign up
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageTemplate>
  );
}
