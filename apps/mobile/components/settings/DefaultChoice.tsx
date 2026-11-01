import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { Button } from "../ui/primitives";
import { readyProviders } from "../chat/ModelSheet";
import { usePatchAgentProviders } from "../../lib/hooks";
import { PROVIDER_LABELS, type AgentProviders, type ProviderId } from "../../lib/api/agentProviders";
import { createThemedStyleSheet } from "../../lib/theme";

/** The providers that could run new chats now, leaving out `except`. */
export function readyIds(data: AgentProviders | undefined, except?: ProviderId): ProviderId[] {
  return readyProviders(data)
    .map((p) => p.id)
    .filter((id) => id !== except);
}

/** Asked right after a provider is set up while no default is chosen. */
export type ChooseRequest = { kind: "choose"; initial: ProviderId };

/** Removing or disconnecting a provider. When it is the chosen default and
 * another provider is set up, the same sheet asks which one takes its place. */
export type RemoveRequest = {
  kind: "remove";
  id: ProviderId;
  title: string;
  message: string;
  confirmLabel: string;
  onRemove: () => Promise<unknown>;
};

export type ProviderRequest = ChooseRequest | RemoveRequest;

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** One sheet for both steps (ADR 0020). The choice is saved before a removal,
 * so a provider that fails its test call leaves nothing removed. */
export function ProviderSheet({
  data,
  request,
  onClose,
}: {
  data: AgentProviders;
  request: ProviderRequest | null;
  onClose: () => void;
}) {
  const patch = usePatchAgentProviders();
  // Keep the last request on screen while the sheet slides away.
  const last = useRef<ProviderRequest | null>(null);
  if (request) last.current = request;
  const shown = request ?? last.current;
  const options =
    shown?.kind === "choose"
      ? readyIds(data)
      : shown && data.defaultChosen && data.defaultProvider === shown.id
        ? readyIds(data, shown.id)
        : [];
  const [choice, setChoice] = useState<ProviderId | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!request) return;
    const ids = request.kind === "choose" ? readyIds(data) : readyIds(data, request.id);
    setChoice(request.kind === "choose" && ids.includes(request.initial) ? request.initial : (ids[0] ?? ""));
    setError("");
    setPending(false);
    // Only a new request resets the pick; a data refresh keeps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const choose = shown?.kind === "choose";
  const title = choose ? "Which provider runs new chats?" : (shown?.title ?? "");
  const body = choose
    ? "Chats and Help me write wait until you choose. You can change this later under Default provider."
    : shown
      ? options.length
        ? `${shown.message} Choose which provider runs new chats and Help me write instead.`
        : shown.message
      : "";
  const confirmLabel = choose
    ? choice
      ? `Use ${PROVIDER_LABELS[choice]}`
      : "Use"
    : (shown?.confirmLabel ?? "");

  const confirm = async () => {
    if (!shown) return;
    setPending(true);
    setError("");
    try {
      if (shown.kind === "choose") {
        if (choice) await patch.mutateAsync({ defaultProvider: choice });
      } else {
        if (options.length && choice) await patch.mutateAsync({ defaultProvider: choice });
        await shown.onRemove();
      }
      onClose();
    } catch (err) {
      setError(message(err, shown.kind === "choose" ? "Could not switch provider." : "Could not finish. Try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <BottomSheet
      open={request !== null}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={title}
      footer={
        <View style={styles.row}>
          <View style={styles.cell}>
            <Button
              label={choose ? "Not now" : "Cancel"}
              variant="secondary"
              size="lg"
              stretch
              disabled={pending}
              onPress={onClose}
            />
          </View>
          <View style={styles.cell}>
            <Button
              label={pending ? (choose || (options.length && choice) ? "Checking…" : "Removing…") : confirmLabel}
              variant={choose ? "primary" : "destructive"}
              size="lg"
              stretch
              loading={pending}
              disabled={choose && !choice}
              onPress={() => void confirm()}
              testID="provider-sheet-confirm"
            />
          </View>
        </View>
      }
    >
      <Text style={styles.message}>{body}</Text>
      {options.length ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Default provider" style={styles.options}>
          {options.map((id) => (
            <SheetOption key={id} selected={choice === id} onSelect={() => !pending && setChoice(id)}>
              {PROVIDER_LABELS[id]}
            </SheetOption>
          ))}
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  message: { color: colors.mutedForeground, fontSize: 15, lineHeight: 22, paddingBottom: 12 },
  options: { gap: 2, paddingBottom: 8 },
  error: { color: colors.destructive, fontSize: 13, lineHeight: 18, paddingBottom: 12 },
  row: { flexDirection: "row", gap: 10 },
  cell: { flex: 1 },
}));
