"use client";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
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
import { loginUser, getCurrentUser } from "@/redux/user/userSlice";

export default function LoginForm() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const userId = useAppSelector(state => state.user.user?._id);
  // The shared Redux `isLoading` is also set by the mount-time session check,
  // so it cannot drive this form's disabled state: a stalled revalidation left
  // a returning user staring at "Logging in..." with no way to submit.
  const [submitting, setSubmitting] = useState(false);
  const freshLoginRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("redirect");
    // `startsWith("/")` is not an allowlist. It accepts "//evil.com", and WHATWG
    // URL parsing treats "\" as "/" and strips control characters, so even
    // "/\evil.com" or "/\t/evil.com" resolve cross-origin. The sink below runs
    // after a *successful* login, so an off-origin target is a phishing
    // primitive. Resolve against this origin and keep only same-origin paths.
    let safeTarget: string | null = null;
    if (target && !/[\u0000-\u001F\u007F]/.test(target)) {
      try {
        const resolved = new URL(target, window.location.origin);
        if (
          resolved.origin === window.location.origin &&
          target.startsWith("/") &&
          !target.startsWith("//") &&
          !target.startsWith("/\\")
        ) {
          safeTarget = resolved.pathname + resolved.search + resolved.hash;
        }
      } catch {
        // A malformed href is not a destination.
      }
    }
    setRedirectTo(safeTarget);
  }, []);

  // A persisted user alone is not proof of a valid session. Re-validate the
  // cookie-backed user on the server before trusting the persisted state; if the
  // cookie is gone, getCurrentUser rejects and clears the user, breaking the
  // login <-> dashboard redirect loop.
  //
  // The redirect below waits on `sessionChecked`. Redirecting on the raw
  // persisted `userId` sent the browser to /dashboard, where middleware found no
  // token and bounced it straight back -- repeatedly, once per bounce, until the
  // revalidation finally landed. That window opens on every visit after the
  // 15-day cookie expires while the persisted flag lives on, so it is the
  // ordinary returning-user path, not an edge case.
  const [sessionChecked, setSessionChecked] = useState(!userId);
  useEffect(() => {
    const userIdAtMount = userId;
    if (!userIdAtMount) return;
    let cancelled = false;
    dispatch(getCurrentUser()).then((result) => {
      if (cancelled) return;
      setSessionChecked(true);
      // A fresh login already owns the session and redirects on its own. A late
      // 401 from the mount-time check must not clear that state or show a false
      // "session expired" toast after the user successfully signed in.
      if (freshLoginRef.current) return;
      if (getCurrentUser.rejected.match(result)) {
        const payload = result.payload as
          | { message?: string; unauthenticated?: boolean }
          | undefined;
        toast.error(
          payload?.message || "Could not verify your session. Please try again.",
          { duration: 4000 }
        );
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useEffect(() => {
    if (sessionChecked && userId) {
      router.replace(redirectTo || "/dashboard");
    }
  }, [sessionChecked, userId, router, redirectTo]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    freshLoginRef.current = true;
    try {
      const result = await dispatch(loginUser({ email, password }));
      if (loginUser.rejected.match(result)) {
        toast.error((result.payload as string) || "Invalid email or password");
      } else if (loginUser.fulfilled.match(result)) {
        // Redirect from the submit that actually succeeded. The shared reducer
        // state can still be cleared by the older revalidation, so waiting for
        // it here could leave a validly logged-in user stuck on this form.
        router.replace(redirectTo || "/dashboard");
      }
    } finally {
      setSubmitting(false);
    }
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

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Logging in..." : "Login"}
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
