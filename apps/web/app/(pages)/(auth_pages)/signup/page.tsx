"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";
import { getHealth } from "@/app/utils/api/instance";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import AuthShell, { NowBlock } from "@/app/_components/auth/authShell";
import DayPanel, { type DayBlock } from "@/app/_components/auth/dayPanel";
import {
  AuthField,
  AuthNotice,
  PasswordField,
} from "@/app/_components/auth/fields";
import { SIGN_UP_DAY } from "@/app/_components/auth/sampleDay";

const CLOSED_RED = "#E5484D";

const CLOSED_DAY: DayBlock[] = [
  {
    id: "now",
    title: "Sign-ups are closed",
    at: 0,
    length: 20,
    color: CLOSED_RED,
    state: "now",
  },
  { id: "a", title: "", at: 30, length: 60, color: CLOSED_RED, state: "ghost" },
  {
    id: "b",
    title: "",
    at: 100,
    length: 45,
    color: CLOSED_RED,
    state: "ghost",
  },
];

/** Shown instead of the form when the server takes no new accounts. */
function SignupClosed() {
  return (
    <AuthShell
      block={<NowBlock label="Sign-ups closed" color={CLOSED_RED} />}
      title="New accounts are turned off here."
      lead="This Timely already has its owner, and only the first account can sign up on its own. If this is your Timely, sign in."
      aside={
        <DayPanel title="This server" blocks={CLOSED_DAY} hoursBefore={1} />
      }
    >
      <div className="flex flex-wrap gap-2.5">
        <Link href="/login" className={buttonClass({ size: "lg" })}>
          Sign in
          <ArrowRight />
        </Link>
        <Link
          href="/help/account/server#pairing-and-access"
          className={buttonClass({ variant: "outline", size: "lg" })}
        >
          How accounts work
        </Link>
      </div>
      <p className="mt-8 max-w-[44ch] text-sm leading-relaxed text-[var(--lp-soft)]">
        To let someone else join, the owner turns on{" "}
        <span className="text-[var(--lp-ink)]">Allow new accounts</span> in
        Settings, Server in the desktop app, or sets{" "}
        <code className="lp-mono rounded bg-white/5 px-1 py-0.5 text-[0.8125rem] text-[var(--lp-ink)]">
          ALLOW_REGISTRATION=true
        </code>{" "}
        on a self-hosted server.
      </p>
    </AuthShell>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState("");
  const [success, setSuccess] = useState(false);
  // The form shows while this loads; a closed server swaps it for SignupClosed.
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: false,
    staleTime: 30_000,
  });

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

  if (health.data?.registrationOpen === false && !success)
    return <SignupClosed />;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      setValidationError("Fill in your name, email and a password.");
      return;
    }
    if (password.length < 8) {
      setValidationError("Use a password of at least 8 characters.");
      return;
    }
    signupMutation.mutate();
  };

  const errorMessage = !success
    ? validationError || signupMutation.error?.message
    : "";
  const firstName = name.trim().split(/\s+/)[0];

  return (
    <AuthShell
      block={<NowBlock label="Create your account" />}
      title="Start your first day."
      lead="One account owns this Timely. Your tasks, docs and keys stay on this server, and the assistant runs on the AI you already pay for."
      headerAction={
        <Link href="/login" className={buttonClass({ variant: "outline" })}>
          Log in
        </Link>
      }
      aside={
        <DayPanel
          title={firstName ? `${firstName}’s first day` : "Your first day"}
          blocks={SIGN_UP_DAY}
          hoursBefore={1}
        />
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {success ? (
          <AuthNotice tone="success">
            <span className="flex items-center gap-2">
              <Check className="size-4 text-[var(--lp-green)]" />
              Account created. Setting up your first day…
            </span>
          </AuthNotice>
        ) : null}
        {errorMessage ? <AuthNotice>{errorMessage}</AuthNotice> : null}

        <AuthField
          id="name"
          label="Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sam Rivera"
          autoComplete="name"
          autoFocus
        />

        <AuthField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          hint="At least 8 characters."
        />

        <Button
          type="submit"
          size="lg"
          disabled={success}
          loading={signupMutation.isPending}
          trailing={signupMutation.isPending ? null : <ArrowRight />}
          className="mt-2 w-full"
        >
          {signupMutation.isPending ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-[var(--lp-soft)]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--lp-now)] underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
