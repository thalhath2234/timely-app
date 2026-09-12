"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe, useUpdateMe } from "@/app/utils/hooks/user";
import { listSessions, revokeSession, type DeviceSession } from "@/app/utils/api/user";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";
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
          className="w-full rounded-lg border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="w-full rounded-lg border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40"
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
          className="w-full rounded-lg border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">New password</span>
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          className="w-full rounded-lg border border-border bg-input/30 px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40"
        />
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {message && <p className="text-xs text-success">{message}</p>}

      <div>
        <button
          type="submit"
          disabled={updateMe.isPending}
          className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
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

  return (
    <section className="mt-8 flex max-w-lg flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">Devices</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Sign out a device if you no longer use it.
        </p>
      </div>
      {sessions.isError ? (
        <p className="text-xs text-destructive">Could not load sessions.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(sessions.data ?? []).map((session: DeviceSession) => (
          <li
            key={session.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {session.deviceLabel || "Unknown device"}
                {session.current ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    this device
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                Last used {session.lastUsedAt}
              </p>
            </div>
            {!session.revokedAt ? (
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(session.id)}
                className="shrink-0 text-xs text-destructive hover:underline disabled:opacity-60"
              >
                Log out
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">Revoked</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
