import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Eye } from "lucide-react-native";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import AnimatedPressable from "../ui/AnimatedPressable";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import {
  PROVIDER_LABELS,
  type AgentProviders,
  type ProviderId,
} from "../../lib/api/agentProviders";
import {
  useAgentProvidersQuery,
  useProviderModelsQuery,
} from "../../lib/hooks";

/** A model picked for one conversation; an empty provider follows the
 * account default in Settings → Agent. */
export type ModelChoice = { provider: string; model: string };

const label = (id: string) => PROVIDER_LABELS[id as ProviderId] ?? id;

/** Connected providers with the model each one runs by default. */
export function readyProviders(data: AgentProviders | undefined) {
  if (!data) return [];
  const list: { id: ProviderId; model: string }[] = [];
  if (data.openrouter.ready)
    list.push({ id: "openrouter", model: data.openrouter.chatModel });
  if (data.localCli && data.claude.ready)
    list.push({ id: "claude", model: data.claude.model });
  if (data.localCli && data.codex.ready)
    list.push({ id: "codex", model: data.codex.model });
  for (const api of data.apiProviders ?? [])
    if (api.ready) list.push({ id: api.id, model: api.model });
  return list;
}

export function modelLabel(value: ModelChoice) {
  return value.provider ? value.model || label(value.provider) : "Default";
}

export default function ModelSheet({
  open,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  value: ModelChoice;
  onClose: () => void;
  onPick: (next: ModelChoice) => void;
}) {
  const providers = useAgentProvidersQuery();
  const ready = readyProviders(providers.data);
  const defaultId = providers.data?.defaultProvider;
  const defaultModel = ready.find((p) => p.id === defaultId)?.model ?? "";
  const [browsing, setBrowsing] = useState("");
  const [query, setQuery] = useState("");
  const shown =
    (ready.some((p) => p.id === browsing) && browsing) ||
    value.provider ||
    defaultId ||
    ready[0]?.id ||
    "";
  const models = useProviderModelsQuery(
    shown as ProviderId,
    undefined,
    open && ready.some((p) => p.id === shown),
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = models.data ?? [];
    return (
      needle
        ? list.filter(
            (m) =>
              m.id.toLowerCase().includes(needle) ||
              m.name.toLowerCase().includes(needle),
          )
        : list
    ).slice(0, 60);
  }, [models.data, query]);
  const pick = (next: ModelChoice) => {
    onClose();
    setQuery("");
    setBrowsing("");
    if (next.provider !== value.provider || next.model !== value.model)
      onPick(next);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Model">
      <Text style={styles.hint}>
        Applies to this conversation from the next reply.
      </Text>
      <SheetOption
        selected={!value.provider}
        onSelect={() => pick({ provider: "", model: "" })}
      >
        <Text style={styles.name}>Default</Text>
        <Text numberOfLines={1} style={styles.sub}>
          {defaultId
            ? `${label(defaultId)}${defaultModel ? ` · ${defaultModel}` : ""}`
            : "Set in Settings → Agent"}
        </Text>
      </SheetOption>
      {providers.isLoading ? (
        <Text style={styles.hint}>Loading providers…</Text>
      ) : !ready.length ? (
        <Text style={styles.hint}>
          No provider is connected. Connect one in Settings → Agent.
        </Text>
      ) : (
        <>
          {ready.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.tabs}
            >
              {ready.map((p) => (
                <AnimatedPressable
                  key={p.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: p.id === shown }}
                  onPress={() => {
                    setBrowsing(p.id);
                    setQuery("");
                  }}
                  style={[styles.tab, p.id === shown && styles.tabOn]}
                >
                  <Text
                    style={[styles.tabText, p.id === shown && styles.tabTextOn]}
                  >
                    {label(p.id)}
                  </Text>
                </AnimatedPressable>
              ))}
            </ScrollView>
          ) : null}
          <TextInput
            accessibilityLabel="Search models"
            placeholder={`Search ${label(shown)} models…`}
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={colors.primary}
            style={styles.search}
          />
          {models.isLoading ? (
            <Text style={styles.hint}>Loading models…</Text>
          ) : models.error ? (
            <Text style={[styles.hint, { color: colors.destructive }]}>
              {(models.error as Error).message}
            </Text>
          ) : !filtered.length ? (
            <Text style={styles.hint}>No matches.</Text>
          ) : (
            filtered.map((m) => (
              <SheetOption
                key={m.id}
                selected={value.provider === shown && value.model === m.id}
                onSelect={() => pick({ provider: shown, model: m.id })}
                leading={
                  m.vision ? (
                    <Eye size={16} color={colors.mutedForeground} />
                  ) : undefined
                }
              >
                <Text numberOfLines={1} style={styles.name}>
                  {m.name}
                </Text>
                {m.name !== m.id ? (
                  <Text numberOfLines={1} style={styles.sub}>
                    {m.id}
                  </Text>
                ) : null}
              </SheetOption>
            ))
          )}
        </>
      )}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet(() => ({
  hint: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 8,
  },
  name: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  sub: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  tabs: { gap: 6, paddingVertical: 10 },
  tab: {
    height: 32,
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: "center",
    backgroundColor: colors.muted,
  },
  tabOn: { backgroundColor: colors.accent },
  tabText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
  tabTextOn: { color: colors.primary },
  search: {
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.foreground,
    fontSize: 15,
    marginBottom: 6,
  },
}));
