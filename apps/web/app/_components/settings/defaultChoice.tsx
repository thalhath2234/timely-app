"use client";

import { useState } from "react";
import { Check, CircleAlert, Sparkles } from "lucide-react";
import ConfirmDialog from "@/app/_components/_ui/confirmDialog";
import { ListGroup } from "@/app/_components/_ui/groupedList";
import { readyProviders } from "@/app/_components/chat/modelMenu";
import { cn } from "@/app/utils/cn";
import { usePatchAgentProviders } from "@/app/utils/hooks/agentProviders";
import { PROVIDER_LABELS, type AgentProviders, type ProviderId } from "@/app/utils/api/agentProviders";

/** The providers that could run new chats now, leaving out `except`. */
export function readyIds(data: AgentProviders | undefined, except?: ProviderId): ProviderId[] {
  return readyProviders(data)
    .map((p) => p.id)
    .filter((id) => id !== except);
}

/** One pick from the set-up providers, as grouped rows: the name on the left,
 * a check on the right of the chosen one. Shared by the ask after a key is
 * saved and by removing the default (ADR 0020). */
export function ProviderChoice({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: ProviderId[];
  value: ProviderId | "";
  onChange: (id: ProviderId) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-3">
      <ListGroup>
        {options.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={cn(
              "flex min-h-10 w-full cursor-pointer items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
              value === id && "bg-primary/[0.06]",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {PROVIDER_LABELS[id]}
            </span>
            {value === id ? <Check aria-hidden className="size-4 shrink-0 text-primary" /> : null}
          </button>
        ))}
      </ListGroup>
    </div>
  );
}

function ChoiceError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-destructive">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{error}</span>
    </p>
  );
}

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** Asked right after a provider is set up while no default is chosen: which
 * provider runs new chats and Help me write, with the new one selected. */
export function ChooseDefaultDialog({
  data,
  initial,
  onClose,
}: {
  data: AgentProviders;
  initial: ProviderId;
  onClose: () => void;
}) {
  const patch = usePatchAgentProviders();
  const options = readyIds(data);
  const [choice, setChoice] = useState<ProviderId>(options.includes(initial) ? initial : options[0]);
  const [error, setError] = useState("");
  if (!choice) return null;
  return (
    <ConfirmDialog
      tone="primary"
      icon={<Sparkles className="size-4" />}
      title="Which provider runs new chats?"
      description="Chats and Help me write wait until you choose. You can change this later under Default provider."
      confirmLabel={`Use ${PROVIDER_LABELS[choice]}`}
      cancelLabel="Not now"
      pending={patch.isPending}
      pendingLabel="Checking…"
      onCancel={onClose}
      onConfirm={() => {
        setError("");
        patch.mutate(
          { defaultProvider: choice },
          { onSuccess: onClose, onError: (err) => setError(message(err, "Could not switch provider.")) },
        );
      }}
    >
      <ProviderChoice
        label="Default provider"
        options={options}
        value={choice}
        onChange={setChoice}
        disabled={patch.isPending}
      />
      <ChoiceError error={error} />
    </ConfirmDialog>
  );
}

/** Confirms removing or disconnecting a provider. When it is the default and
 * another provider is set up, the same step asks which one takes its place;
 * that switch runs first, so a provider that fails its test call leaves
 * nothing removed. */
export function RemoveProviderDialog({
  data,
  id,
  title,
  description,
  confirmLabel,
  onRemove,
  onClose,
}: {
  data: AgentProviders;
  id: ProviderId;
  title: string;
  description: string;
  confirmLabel: string;
  onRemove: () => Promise<unknown>;
  onClose: () => void;
}) {
  const patch = usePatchAgentProviders();
  const options = data.defaultChosen && data.defaultProvider === id ? readyIds(data, id) : [];
  const [choice, setChoice] = useState<ProviderId | "">(options[0] ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <ConfirmDialog
      title={title}
      description={
        options.length ? `${description} Choose which provider runs new chats and Help me write instead.` : description
      }
      confirmLabel={confirmLabel}
      pendingLabel={choice ? "Switching…" : "Removing…"}
      pending={pending}
      onCancel={onClose}
      onConfirm={async () => {
        setPending(true);
        setError("");
        try {
          if (choice) await patch.mutateAsync({ defaultProvider: choice });
          await onRemove();
          onClose();
        } catch (err) {
          setError(message(err, "Could not finish. Try again."));
        } finally {
          setPending(false);
        }
      }}
    >
      {options.length ? (
        <ProviderChoice label="Default provider" options={options} value={choice} onChange={setChoice} disabled={pending} />
      ) : null}
      <ChoiceError error={error} />
    </ConfirmDialog>
  );
}
