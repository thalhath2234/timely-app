"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getMe } from "@/app/utils/api/user";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import AuthShell, { NowBlock } from "@/app/_components/auth/authShell";
import DayPanel from "@/app/_components/auth/dayPanel";
import {
  AuthField,
  AuthNotice,
  PasswordField,
} from "@/app/_components/auth/fields";
import { SIGN_IN_DAY } from "@/app/_components/auth/sampleDay";

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
      setValidationError("Enter your email and password.");
      return;
    }
    loginMutation.mutate();
  };

  const errorMessage = validationError || loginMutation.error?.message;

  return (
    <AuthShell
      block={<NowBlock label="Sign in" />}
      title="Pick up where you left off."
      lead="Your week is where you left it: tasks placed around your meetings, and the assistant ready when you are."
      headerAction={
        <Link href="/signup" className={buttonClass({ variant: "outline" })}>
          Register
        </Link>
      }
      aside={<DayPanel title="Your day" blocks={SIGN_IN_DAY} />}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {errorMessage ? <AuthNotice>{errorMessage}</AuthNotice> : null}

        <AuthField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
        />

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        <Button
          type="submit"
          size="lg"
          loading={loginMutation.isPending}
          trailing={loginMutation.isPending ? null : <ArrowRight />}
          className="mt-2 w-full"
        >
          {loginMutation.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-[var(--lp-soft)]">
        New to Timely?{" "}
        <Link
          href="/signup"
          className="font-medium text-[var(--lp-now)] underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>

      {process.env.NODE_ENV === "development" ? (
        <div className="mt-8 rounded-[10px] border border-dashed border-[var(--lp-line)] p-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-[var(--lp-soft)]">
              Development seed account
            </p>
            <button
              type="button"
              className="lp-mono text-xs text-[var(--lp-now)] hover:underline"
              onClick={() => {
                setEmail("thalhathva2@gmail.com");
                setPassword("12341234");
                setValidationError("");
              }}
            >
              Autofill
            </button>
          </div>
          <p className="lp-mono mt-1.5 text-xs text-[var(--lp-soft)] select-all">
            thalhathva2@gmail.com · 12341234
          </p>
        </div>
      ) : null}
    </AuthShell>
  );
}
