"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe, useUpdateMe } from "@/app/utils/hooks/user";
import { listSessions, revokeOtherSessions, revokeSession, type DeviceSession } from "@/app/utils/api/user";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";
import { formatLastUsed, humanizeDeviceLabel } from "@/app/utils/deviceLabel";
import { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { useRouter } from "next/navigation";

export default function AccountSettings() {
  const { data: user, isLoading } = useMe();

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading account…</p>
    );
  }

  if (!user) {
    return (
      <p className="text-sm text-muted-foreground">Could not load account.</p>
    );
  }

  return (
    <>
      <AccountSettingsForm
        key={`${user.id}:${user.email}:${user.name ?? ""}`}
        initialName={user.name ?? ""}
        initialEmail={user.email}
      />
      <DeviceSessions />
    </>
  );
}

function AccountSettingsForm({
  initialName,
  initialEmail,
}: {
  initialName: string;
  initialEmail: string;
}) {
  const updateMe = useUpdateMe();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    try {
      await updateMe.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        currentPassword: newPassword ? currentPassword : undefined,
        newPassword: newPassword || undefined,
      });
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-lg flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Account</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Update your display name, email, and password.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          className="w-full rounded-lg border border-white/10 bg-[#0c0e14] px-3 py-2 text-sm text-foreground outline-none transition focus:border-[#c0c1ff] focus:ring-1 focus:ring-[#c0c1ff]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="w-full rounded-lg border border-white/10 bg-[#0c0e14] px-3 py-2 text-sm text-foreground outline-none transition focus:border-[#c0c1ff] focus:ring-1 focus:ring-[#c0c1ff]"
        />
      </label>

      <div className="h-px bg-border" />

      <div>
        <h3 className="text-sm font-medium text-foreground">Change password</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Leave blank to keep your current password.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Current password</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          className="w-full rounded-lg border border-white/10 bg-[#0c0e14] px-3 py-2 text-sm text-foreground outline-none transition focus:border-[#c0c1ff] focus:ring-1 focus:ring-[#c0c1ff]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">New password</span>
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          className="w-full rounded-lg border border-white/10 bg-[#0c0e14] px-3 py-2 text-sm text-foreground outline-none transition focus:border-[#c0c1ff] focus:ring-1 focus:ring-[#c0c1ff]"
        />
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {message && <p className="text-xs text-success">{message}</p>}

      <div>
        <button
          type="submit"
          disabled={updateMe.isPending}
          className="cursor-pointer rounded-lg bg-[#c0c1ff] px-3 py-1.5 text-sm font-medium text-[#1000a9] hover:bg-[#a8a6ff] disabled:opacity-60"
        >
          {updateMe.isPending ? "Saving…" : "Save account"}
        </button>
      </div>
    </form>
  );
}

function DeviceSessions() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: listSessions });
  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: async (_data, id) => {
      const current = sessions.data?.find((item) => item.id === id)?.current;
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (current) {
        await apiFetch("/logout", { method: "POST" });
        setAccessToken(null);
        router.push("/login");
        router.refresh();
      }
    },
  });
  const revokeOthers = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });
  const otherActive = (sessions.data ?? []).filter((item) => !item.current).length;

  return (
    <section className="mt-8 flex max-w-lg flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">Devices</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Sign out a device if you no longer use it.
        </p>
      </div>
      {otherActive > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {otherActive} other {otherActive === 1 ? "session" : "sessions"} still signed in.
          </p>
          <button
            type="button"
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
            className="shrink-0 text-xs text-destructive hover:underline disabled:opacity-60"
          >
            {revokeOthers.isPending ? "Signing out…" : "Sign out everywhere else"}
          </button>
        </div>
      ) : null}
      {sessions.isError ? (
        <LoadErrorBanner
          what="devices"
          error={sessions.error}
          onRetry={() => sessions.refetch()}
          retrying={sessions.isFetching}
        />
      ) : null}
      <ul className="flex flex-col gap-2">
        {(sessions.data ?? []).map((session: DeviceSession) => (
          <li
            key={session.id}
            className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${
              session.current ? "border-[#c0c1ff]/40 bg-[#c0c1ff]/8" : "border-white/10 bg-[#191b22]"
            }`}
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{humanizeDeviceLabel(session.deviceLabel)}</span>
                {session.current ? (
                  <span className="rounded-full bg-[#c0c1ff] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#1000a9]">
                    This device
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground" title={session.lastUsedAt}>
                Last used {formatLastUsed(session.lastUsedAt)}
                {session.createdAt ? ` · signed in ${formatLastUsed(session.createdAt)}` : ""}
              </p>
              {session.deviceLabel ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                    Technical details
                  </summary>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {session.deviceLabel}
                  </p>
                </details>
              ) : null}
            </div>
            <button
              type="button"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(session.id)}
              className="shrink-0 text-xs text-destructive hover:underline disabled:opacity-60"
            >
              Log out
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
