/* eslint-disable @typescript-eslint/no-misused-promises */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { User, Lock, LogIn } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import type { LoginRequest } from "@/types/auth";
import { login, fetchMe, setAuthToken } from "@/api/auth";

export default function LoginPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const userRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    userRef.current?.focus();
  }, []);

  const redirectTo = sp.get("redirectTo") || "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.warning("Required fields", {
        description: "Enter your username and password.",
      });
      return;
    }

    const payload: LoginRequest = { username: username.trim(), password };
    setLoading(true);

    try {
      const p = login(payload);
      toast.promise(p, {
        loading: "Signing in…",
        success: "Signed in",
        error: "Login failed",
      });

      const tokenRes = await p;
      setAuthToken(tokenRes.access_token);

      // Optional: fetch current user (will help populate your header/store if needed)
      try {
        await fetchMe();
      } catch {
        /* ignore — token is enough to proceed */
      }

      navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      toast.error("Could not sign in", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto grid min-h-[75vh] max-w-md place-items-center px-4 py-10">
      <Card className="w-full shadow-sm">
        <CardContent className="space-y-6 p-6">
          <header className="text-center">
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Access the route optimizer
            </p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  ref={userRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ex: planificateur"
                  autoComplete="username"
                  className="pl-9"
                  minLength={3}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pl-9 pr-20"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:underline"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="mt-2 inline-flex w-full items-center justify-center gap-2"
              disabled={loading}
            >
              <LogIn className="h-4 w-4" aria-hidden />
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Need an account? Contact your administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
