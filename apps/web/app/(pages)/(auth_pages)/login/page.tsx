"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import * as motion from "motion/react-client";
import { getMe } from "@/app/utils/api/user";

export default function LoginPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async () => {
      setValidationError("");
      const response = await fetch("http://localhost:8080/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }
      return data;
    },
    onSuccess: async () => {
      const me = await getMe();

      queryClient.setQueryData(["me"], me);
      console.log("me: ", me)

      if (me.isOnBoardingCompleted ?? me.IsOnBoardingCompleted) {
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
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-[#152331] to-[#0a0e14] p-4 text-white">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-8 relative overflow-hidden"
      >
        {/* Decorative glowing sphere background */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center mb-8 relative">
          <h1 className="text-3xl font-extrabold tracking-tight bg-linear-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Welcome Back
          </h1>
          <p className="text-slate-400 text-sm mt-2">
            Sign in to manage your schedule with Timely
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 relative">
          {/* Error Alerts */}
          {(validationError || loginMutation.isError) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm"
            >
              <AlertCircle className="size-5 shrink-0" />
              <span>{validationError || loginMutation.error?.message}</span>
            </motion.div>
          )}

          {/* Email Input */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300 block">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/40 border border-white/10 rounded-xl outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition text-sm placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-slate-300">
                Password
              </label>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/40 border border-white/10 rounded-xl outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition text-sm placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 bg-linear-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-blue-500/50 disabled:to-purple-600/50 rounded-xl font-semibold text-sm transition cursor-pointer shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] select-none"
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

        <div className="mt-8 text-center text-sm text-slate-400 relative">
          "Don&apos;t have an account?"{" "}
          <Link
            href="/signup"
            className="text-blue-400 hover:underline font-semibold"
          >
            Sign up
          </Link>
        </div>

        {/* Demo Helper Message */}
        <div className="mt-6 pt-5 border-t border-white/5 text-center text-xs text-slate-500 relative">
          <p className="font-semibold text-slate-400">Demo Account Info:</p>
          <p className="mt-1">
            Email: <code className="text-blue-300">user@example.com</code>
          </p>
          <p>
            Password: <code className="text-blue-300">password123</code>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
