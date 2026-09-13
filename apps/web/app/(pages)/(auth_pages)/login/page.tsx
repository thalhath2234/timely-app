"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import * as motion from "motion/react-client";
import { getMe } from "@/app/utils/api/user";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";

export default function LoginPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async () => {
      setValidationError("");
      const response = await apiFetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || "Login failed");
      }
      setAccessToken(data.token);
      return data;
    },
    onSuccess: async () => {
      const me = await getMe();

      queryClient.setQueryData(["me"], me);
      console.log("me: ", me)

      if (me.is_on_boarding_completed) {
        router.replace("/calendar");
      } else {
        router.replace("/onboarding");
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setValidationError("Please fill in all fields.");
      return;
    }
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 text-foreground">
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-card text-card-foreground border border-border shadow-xl rounded-2xl p-8 relative overflow-hidden"
      >
        {/* Decorative glowing sphere background */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-chart-3/20 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center mb-8 relative">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            Welcome Back
          </h1>
          <p className="text-muted-foreground text-sm mt-2">
            Sign in to manage your schedule with Timely
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 relative">
          {/* Error Alerts */}
          {(validationError || loginMutation.isError) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive p-3 rounded-lg text-sm"
            >
              <AlertCircle className="size-5 shrink-0" />
              <span>{validationError || loginMutation.error?.message}</span>
            </motion.div>
          )}

          {/* Email Input */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground block">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-10 pr-4 py-2.5 bg-input/30 border border-border rounded-xl outline-none focus:border-ring focus:ring-1 focus:ring-ring/40 transition text-sm placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-foreground">
                Password
              </label>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-input/30 border border-border rounded-xl outline-none focus:border-ring focus:ring-1 focus:ring-ring/40 transition text-sm placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 rounded-xl font-semibold text-sm transition cursor-pointer shadow-sm active:scale-[0.98] select-none"
          >
            {loginMutation.isPending ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                Sign In
                <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-muted-foreground relative">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-primary hover:underline font-semibold"
          >
            Sign up
          </Link>
        </div>
        {process.env.NODE_ENV === "development" ? (
          <div className="mt-6 pt-5 border-t border-border text-center text-xs text-muted-foreground relative">
            <p className="font-semibold text-foreground">Development seed account</p>
            <p className="mt-1">
              Email: <code className="text-primary font-mono">user@example.com</code>
            </p>
            <p>
              Password: <code className="text-primary font-mono">password123</code>
            </p>
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
