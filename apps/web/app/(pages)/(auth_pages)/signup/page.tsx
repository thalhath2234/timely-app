"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  User,
  Mail,
  Lock,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";
import AuthBrandPanel from "../_components/authBrandPanel";
import { motion } from "motion/react";
import { springSoft } from "@/app/_components/_ui/motion";

const fieldClass =
  "flex h-11 w-full items-center rounded-lg border border-white/10 bg-[#0c0e14] transition focus-within:border-[#c0c1ff] focus-within:ring-1 focus-within:ring-[#c0c1ff]";
const inputClass =
  "h-full w-full bg-transparent pr-3.5 text-sm text-[#e2e2eb] outline-none placeholder:text-[#908fa0]/70";
const labelClass =
  "mb-2 block text-[0.6875rem] font-medium tracking-[0.08em] text-[#c7c4d7] uppercase";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [success, setSuccess] = useState(false);

  const signupMutation = useMutation({
    mutationFn: async () => {
      setValidationError("");
      const response = await apiFetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || "Signup failed");
      }
      setAccessToken(data.token);
      return data;
    },
    onSuccess: () => {
      setSuccess(true);
      setTimeout(() => {
        router.push("/onboarding");
        router.refresh();
      }, 400);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      setValidationError("Please fill in all fields.");
      return;
    }
    if (password.length < 8) {
      setValidationError("Password must be at least 8 characters long.");
      return;
    }
    signupMutation.mutate();
  };

  const errorMessage = !success
    ? validationError || signupMutation.error?.message
    : "";

  return (
    <main id="main-content" className="flex min-h-screen flex-col bg-[#0c0e14] text-[#e2e2eb] md:flex-row">
      <AuthBrandPanel />

      <section className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-12 sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#282a30_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
          className="relative z-10 w-full max-w-[420px] rounded-xl border border-white/10 bg-[#191b22] p-8 shadow-2xl sm:p-9"
        >
          <div className="mb-6 flex items-center justify-center gap-2.5 md:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#c0c1ff] text-[#1000a9]">
              <span className="text-sm font-bold select-none">T</span>
            </div>
            <span className="text-xl font-semibold tracking-tight">Timely</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Create Account</h1>
          <p className="mt-1.5 text-sm text-[#908fa0]">
            Get started with Timely task manager
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {success ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-[#4edea3]/30 bg-[#00311f]/40 px-3.5 py-3 text-sm font-medium text-[#4edea3]">
                <CheckCircle2 className="size-[18px] shrink-0" />
                <span>Registration successful! Redirecting...</span>
              </div>
            ) : null}

            {errorMessage ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-[#ffb4ab]/30 bg-[#93000a]/20 px-3.5 py-3 text-sm font-medium text-[#ffb4ab]">
                <AlertCircle className="size-[18px] shrink-0" />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            <div>
              <label htmlFor="name" className={labelClass}>
                Full Name
              </label>
              <div className={fieldClass}>
                <User className="ml-3.5 mr-2.5 size-[18px] shrink-0 text-[#908fa0]" />
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  autoComplete="name"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className={labelClass}>
                Email Address
              </label>
              <div className={fieldClass}>
                <Mail className="ml-3.5 mr-2.5 size-[18px] shrink-0 text-[#908fa0]" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className={labelClass}>
                Password
              </label>
              <div className={fieldClass}>
                <Lock className="ml-3.5 mr-2.5 size-[18px] shrink-0 text-[#908fa0]" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="•••••••• (Min 8 characters)"
                  autoComplete="new-password"
                  className={`${inputClass} pr-2`}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((open) => !open)}
                  className="pr-3.5 text-[#908fa0] transition-colors hover:text-[#e2e2eb]"
                >
                  {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={signupMutation.isPending || success}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#c0c1ff] text-sm font-semibold text-[#1000a9] shadow-sm transition hover:bg-[#a8a6ff] focus:outline-none focus:ring-2 focus:ring-[#c0c1ff]/50 active:scale-[0.98] disabled:opacity-60"
              >
                {signupMutation.isPending ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  <>
                    Sign Up
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-[#908fa0]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-[#c0c1ff] transition-colors hover:text-[#e1e0ff] hover:underline"
            >
              Sign in
            </Link>
          </p>
        </motion.div>

        <footer className="relative z-10 mt-8 text-center text-xs text-[#464554]">
          © {new Date().getFullYear()} Timely Technologies Inc. All rights reserved.
        </footer>
      </section>
    </main>
  );
}
