import { useMemo, useState, type ReactNode } from "react";
import {
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown, ChevronUp, Eye, KeyRound } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet, {
  type ConfirmRequest,
} from "../../../components/ui/ConfirmSheet";
import { useLocalSearchParams } from "expo-router";
import { Button, Field, PrimaryButton, Select, type SelectOption } from "../../../components/ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../../../components/settings/SettingsList";
import {
  ProviderSheet,
  readyIds,
  type ProviderRequest,
} from "../../../components/settings/DefaultChoice";
import {
  useAgentChatSettingsQuery,
  useAgentProvidersQuery,
  useConnectProvider,
  useDecisionSettingsQuery,
  useDisconnectProvider,
  useLearnedQuery,
  usePersonalPrefsQuery,
  useResetLearned,
  useSaveUseCase,
  usePatchAgentProviders,
  usePatchDecisionSettings,
  useProviderModelsQuery,
  useRemoveApiProviderKey,
  useRemoveOpenRouterKey,
  useRemoveSourceKey,
  useRemoveTypeSafeKey,
  useSetApiProviderKey,
  useSetDeepWorkTime,
  useSetOpenRouterKey,
  useSetSourceKey,
  useSetTypeSafeKey,
  useSourceKeysQuery,
  useTestDecisions,
} from "../../../lib/hooks";
import type { DecisionSettings, DeepWorkTime } from "../../../lib/api/decisions";
import {
  PROVIDER_LABELS,
  type AgentProviders,
  type ApiProviderView,
  type CliProviderView,
  type ModelOption,
  type ProviderId,
} from "../../../lib/api/agentProviders";
import { providerAfterRemoval } from "@timely/contract/providerFallback";
import type { SourceKeyView } from "@timely/contract/bots";
import { BOT_KEYS_SECTION } from "../../../components/bots/useBotActions";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { LogoSpinner } from "../../../components/ui/TimelyLogo";
import { FocusGroup, FocusGroupScrollView } from "../../../components/ui/FocusGroup";
import EngineCard from "../../../components/settings/EngineCard";
import PermissionsCard from "../../../components/settings/PermissionsCard";
import { LearnedRow } from "../../../components/settings/LearnedParts";

/** A model row's second line: its id when the name differs, and any note. */
function modelDetail(option: ModelOption) {
  const parts = [
    option.name && option.id !== option.name ? option.id : "",
    option.note ?? "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function Badge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted" | "primary";
  children: ReactNode;
}) {
  const color =
    tone === "ok"
      ? colors.success
      : tone === "warn"
        ? colors.warning
        : tone === "primary"
          ? colors.primary
          : colors.mutedForeground;
  return (
    <View
      style={[
        styles.badge,
        { borderColor: `${color}55`, backgroundColor: `${color}1A` },
      ]}
    >
      <Text style={[styles.badgeText, { color }]}>{children}</Text>
    </View>
  );
}

/** Model picker in a bottom sheet with a search field. Saving runs a test
 * call on the server, so the value updates only after the provider answered. */
function ModelPicker({
  label,
  value,
  options,
  loading,
  loadError,
  onSave,
  saving,
  allowCustom,
}: {
  label: string;
  value: string;
  options: ModelOption[] | undefined;
  loading?: boolean;
  loadError?: string | null;
  onSave: (model: string) => Promise<unknown>;
  saving?: boolean;
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = options?.find((option) => option.id === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = options ?? [];
    return (
      needle
        ? list.filter(
            (option) =>
              option.id.toLowerCase().includes(needle) ||
              option.name.toLowerCase().includes(needle),
          )
        : list
    ).slice(0, 80);
  }, [options, query]);
  const custom =
    allowCustom &&
    query.trim() !== "" &&
    !filtered.some((option) => option.id === query.trim());

  const save = async (model: string) => {
    setError(null);
    setOpen(false);
    try {
      await onSave(model);
      setQuery("");
    } catch (err) {
      setError(errorMessage(err, "Could not save this model."));
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.name ?? (value || "not set")}`}
        onPress={() => setOpen(true)}
        disabled={saving}
        style={styles.picker}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.pickerValue} numberOfLines={1}>
            {current?.name ?? (value || "Choose a model")}
          </Text>
          {current && current.id !== current.name ? (
            <Text style={styles.meta} numberOfLines={1}>
              {current.id}
            </Text>
          ) : null}
        </View>
        {saving ? (
          <LogoSpinner size={16} color={colors.mutedForeground} />
        ) : (
          <ChevronDown size={16} color={colors.mutedForeground} />
        )}
      </Pressable>
      {current?.vision ? (
        <View style={styles.row}>
          <Eye size={12} color={colors.mutedForeground} />
          <Text style={styles.meta}>Accepts images</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
        <View style={{ paddingBottom: 8 }}>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="Search models…"
          />
        </View>
        {loading ? <Text style={styles.meta}>Loading models…</Text> : null}
        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
        {custom ? (
          <SheetOption onSelect={() => void save(query.trim())}>
            {`Use “${query.trim()}”`}
          </SheetOption>
        ) : null}
        {filtered.map((option) => (
          <SheetOption
            key={option.id}
            selected={option.id === value}
            trailing={
              option.vision ? (
                <Eye size={16} color={colors.mutedForeground} />
              ) : undefined
            }
            detail={modelDetail(option)}
            onSelect={() => void save(option.id)}
          >
            {option.name || option.id}
          </SheetOption>
        ))}
        {!loading && !loadError && filtered.length === 0 && !custom ? (
          <Text style={styles.meta}>No matches.</Text>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function ProviderCard({
  id,
  description,
  data,
  ready,
  children,
}: {
  id: ProviderId;
  description: string;
  data: AgentProviders;
  ready: boolean;
  children: ReactNode;
}) {
  const patch = usePatchAgentProviders();
  const isDefault = data.defaultProvider === id;
  return (
    <View
      style={[styles.card, isDefault && styles.cardDefault]}
      testID={`provider-${id}`}
    >
      <View style={styles.row}>
        <Text style={styles.title}>{PROVIDER_LABELS[id]}</Text>
        {isDefault ? (
          <Badge tone="primary">Default</Badge>
        ) : ready ? (
          <Badge tone="ok">Ready</Badge>
        ) : null}
      </View>
      <Text style={styles.meta}>{description}</Text>
      {children}
      {!isDefault ? (
        <PrimaryButton
          label={
            patch.isPending && patch.variables?.defaultProvider === id
              ? "Switching…"
              : "Use as default"
          }
          disabled={!ready || patch.isPending}
          onPress={() => patch.mutate({ defaultProvider: id })}
        />
      ) : null}
      {patch.error && patch.variables?.defaultProvider === id ? (
        <Text style={styles.error}>
          {errorMessage(patch.error, "Could not switch provider.")}
        </Text>
      ) : null}
    </View>
  );
}

function OpenRouterCard({
  data,
  ask,
}: {
  data: AgentProviders;
  ask: (req: ProviderRequest) => void;
}) {
  const patch = usePatchAgentProviders();
  const setKey = useSetOpenRouterKey();
  const removeKey = useRemoveOpenRouterKey();
  const chatModels = useProviderModelsQuery("openrouter");
  const embedModels = useProviderModelsQuery("openrouter", "embed");
  const [editing, setEditing] = useState(!data.openrouter.keySet);
  const [key, setKeyValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const reindex = data.reindex;
  const reindexActive =
    reindex.status === "queued" || reindex.status === "running";

  return (
    <ProviderCard
      id="openrouter"
      data={data}
      ready={data.openrouter.ready}
      description="Hosted models with your own API key. Images and receipts use OpenRouter’s zero-data-retention route."
    >
      <Text style={styles.label}>API key</Text>
      {removeKey.error ? (
        <Text style={styles.error}>
          {errorMessage(removeKey.error, "Could not remove the key.")}
        </Text>
      ) : null}
      {!editing ? (
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {data.openrouter.keySet ? (
            <Badge tone="ok">Key saved {data.openrouter.keyHint}</Badge>
          ) : (
            <Badge tone="warn">No key</Badge>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => setEditing(true)}
          >
            <Text style={styles.link}>
              {data.openrouter.keySet ? "Replace" : "Add key"}
            </Text>
          </Pressable>
          {data.openrouter.keySet ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                ask({
                  kind: "remove",
                  id: "openrouter",
                  title: "Remove your OpenRouter key?",
                  message: "OpenRouter chats and semantic search stop until you add one again, and so do smart suggestions unless you have a TypeSafe key.",
                  confirmLabel: "Remove",
                  onRemove: () => removeKey.mutateAsync(),
                })
              }
            >
              <Text style={styles.danger}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FocusGroup style={{ gap: 8 }}>
          <Field
            value={key}
            onChangeText={setKeyValue}
            placeholder="sk-or-v1-…"
            secure
          />
          <Text style={styles.meta}>
            Stored encrypted on the server and never shown again. Saving sends
            one tiny test request.
          </Text>
          {keyError ? <Text style={styles.error}>{keyError}</Text> : null}
          <PrimaryButton
            label={setKey.isPending ? "Checking…" : "Save key"}
            disabled={key.trim().length < 8 || setKey.isPending}
            onPress={() => {
              setKeyError(null);
              setKey.mutate(key.trim(), {
                onSuccess: (next) => {
                  setKeyValue("");
                  setEditing(false);
                  // Nothing becomes the default on its own (ADR 0020): ask now.
                  if (!next.defaultChosen && next.openrouter.ready)
                    ask({ kind: "choose", initial: "openrouter" });
                },
                onError: (err) =>
                  setKeyError(errorMessage(err, "Could not save the key.")),
              });
            }}
          />
          {data.openrouter.keySet ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEditing(false)}
            >
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          ) : null}
        </FocusGroup>
      )}
      <ModelPicker
        label="Chat model"
        value={data.openrouter.chatModel}
        options={chatModels.data}
        loading={chatModels.isLoading}
        loadError={
          chatModels.error
            ? errorMessage(chatModels.error, "Could not load models.")
            : null
        }
        saving={
          patch.isPending && patch.variables?.openrouterChatModel !== undefined
        }
        onSave={(model) => patch.mutateAsync({ openrouterChatModel: model })}
        allowCustom
      />
      <View style={styles.sub}>
        <ModelPicker
          label="Semantic search embedding model"
          value={data.openrouter.embedModel}
          options={embedModels.data}
          loading={embedModels.isLoading}
          loadError={
            embedModels.error
              ? errorMessage(embedModels.error, "Could not load models.")
              : null
          }
          saving={
            patch.isPending &&
            patch.variables?.openrouterEmbedModel !== undefined
          }
          onSave={(model) => patch.mutateAsync({ openrouterEmbedModel: model })}
        />
        <Text style={styles.meta}>
          Must produce 1536-dimension vectors. Changing the key or model
          rebuilds your search index in the background.
        </Text>
        {reindexActive ? (
          <View style={styles.row}>
            <LogoSpinner size={16} color={colors.mutedForeground} />
            <Text style={styles.meta}>
              Rebuilding search index…
              {reindex.total ? ` ${reindex.done} / ${reindex.total}` : ""}
            </Text>
          </View>
        ) : null}
        {reindex.status === "done" ? (
          <Text style={styles.meta}>
            Search index up to date ({reindex.total} items).
            {reindex.skipped
              ? ` ${reindex.skipped === 1 ? "1 item was" : `${reindex.skipped} items were`} skipped because your AI provider refused ${reindex.skipped === 1 ? "it" : "them"}.`
              : ""}
          </Text>
        ) : null}
        {reindex.status === "retrying" ? (
          <Text style={styles.warn} testID="reindex-retrying">
            Index rebuild failed and will try again soon ({reindex.error}).
          </Text>
        ) : null}
        {reindex.status === "failed" ? (
          <Text style={styles.error}>
            Index rebuild failed: {reindex.error}
          </Text>
        ) : null}
      </View>
    </ProviderCard>
  );
}

const TYPESAFE_KEY_URL = "https://typesafe.ai";

/** Smart suggestions across the app. Uses the TypeSafe key first, then the
 * OpenRouter key above; with neither, the Inbox shows no suggestions. */
function SmartSuggestionsCard({
  data,
  confirm,
}: {
  data: DecisionSettings;
  confirm: (req: ConfirmRequest) => void;
}) {
  const patch = usePatchDecisionSettings();
  const setKey = useSetTypeSafeKey();
  const removeKey = useRemoveTypeSafeKey();
  const test = useTestDecisions();
  const typesafe = data.typesafe;
  const [editingKey, setEditing] = useState(false);
  const [key, setKeyValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  // The key form opens by itself only when there is no key at all, as on web.
  const editing = editingKey || (!typesafe.keySet && !data.openrouterKeySet);
  // Suggestions run on Jev, so they switch on only with a key it can use.
  const hasKey = (typesafe.keySet && !typesafe.rejected && !typesafe.unreadable) || data.openrouterKeySet;
  let source: string;
  if (!hasKey)
    source = typesafe.unreadable
      ? "Timely can't read your saved TypeSafe key. Enter it again, or add an OpenRouter key, to turn these on."
      : typesafe.rejected
        ? "TypeSafe refused your key. Add a working TypeSafe or OpenRouter key to turn these on."
        : "Add a TypeSafe or OpenRouter key to turn these on.";
  else if (!data.enabled) source = "Off. Timely works as it does without them.";
  else if (data.provider === "typesafe") source = "Using your TypeSafe key.";
  else if (data.provider === "openrouter")
    source = typesafe.unreadable
      ? "Timely can't read your saved TypeSafe key, so your OpenRouter key is used for now."
      : typesafe.rejected
        ? "TypeSafe refused your key, so your OpenRouter key is used for now."
        : "Using your OpenRouter key. A TypeSafe key is used first when you add one.";
  else source = "Add a TypeSafe or OpenRouter key to turn these on.";

  return (
    <View style={styles.card} testID="smart-suggestions">
      <View style={styles.row}>
        <Text style={styles.title}>Smart suggestions</Text>
        <Badge tone={data.available ? "ok" : hasKey ? "muted" : "warn"}>{data.available ? "On" : hasKey ? "Off" : typesafe.keySet ? "Key not working" : "Needs a key"}</Badge>
        <View style={{ flex: 1 }} />
        <Switch
          accessibilityLabel="Smart suggestions"
          accessibilityHint={hasKey ? undefined : "Add a TypeSafe or OpenRouter key first"}
          value={data.available}
          disabled={patch.isPending || !hasKey}
          onValueChange={(enabled) => patch.mutate(enabled)}
          trackColor={{ true: colors.primary }}
          thumbColor={colors.background}
          // react-native-web colours the "on" thumb with its own prop.
          {...(Platform.OS === "web" ? ({ activeThumbColor: colors.background } as object) : {})}
        />
      </View>
      <Text style={styles.meta}>
        Suggests fields, lengths, places and next steps across the Inbox,
        Today, tasks, projects, docs, sheets, receipts, search and chat.
        Nothing changes until you save or apply. Receipt photos and amounts
        are never sent. Runs on Jev, TypeSafe’s fast decision model.
      </Text>
      <Text style={styles.sourceLine} testID="decisions-source">{source}</Text>
      {/* Test also asks TypeSafe again about a key it refused; if it takes
          the key now, suggestions use it again. */}
      {data.available || (data.enabled && typesafe.rejected) ? (
        <View style={[styles.row, { flexWrap: "wrap" }]} testID="decisions-test">
          <Pressable
            accessibilityRole="button"
            disabled={test.isPending}
            onPress={() => test.mutate()}
            style={styles.row}
          >
            {test.isPending ? <LogoSpinner size={14} color={colors.mutedForeground} /> : null}
            <Text style={styles.link}>Test</Text>
          </Pressable>
          {test.data ? (
            <Text
              style={[test.data.ok ? styles.meta : styles.error, { flex: 1 }]}
              testID="decisions-test-result"
            >
              {test.data.ok
                ? `Working: ${test.data.provider === "typesafe" ? "TypeSafe" : "OpenRouter"} answered in ${test.data.latencyMs} ms.`
                : test.data.error}
            </Text>
          ) : null}
          {test.error ? (
            <Text style={[styles.error, { flex: 1 }]}>
              {errorMessage(test.error, "Could not run the test.")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {patch.error ? (
        <Text style={styles.error}>
          {errorMessage(patch.error, "Could not change this setting.")}
        </Text>
      ) : null}
      <Text style={styles.label}>TypeSafe API key</Text>
      {typesafe.unreadable ? (
        <Text style={styles.warning}>
          Timely can't read this key. Enter it again to use TypeSafe.
        </Text>
      ) : typesafe.rejected ? (
        <Text style={styles.warning}>
          TypeSafe refused this key. Replace it, or test it again, to use TypeSafe.
        </Text>
      ) : null}
      {removeKey.error ? (
        <Text style={styles.error}>
          {errorMessage(removeKey.error, "Could not remove the key.")}
        </Text>
      ) : null}
      {!editing ? (
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {typesafe.keySet ? (
            <Badge tone={typesafe.rejected || typesafe.unreadable ? "warn" : "ok"}>
              {typesafe.unreadable ? "Key can't be read" : "Key saved"} {typesafe.keyHint}
            </Badge>
          ) : (
            <Badge tone="muted">No key</Badge>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => setEditing(true)}
          >
            <Text style={styles.link}>
              {typesafe.keySet ? "Replace" : "Add key"}
            </Text>
          </Pressable>
          {typesafe.keySet ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                confirm({
                  title: "Remove your TypeSafe key?",
                  message: data.openrouterKeySet
                    ? "Suggestions use your OpenRouter key instead."
                    : "Suggestions stop until you add a key again.",
                  confirmLabel: "Remove",
                  onConfirm: () => removeKey.mutate(),
                })
              }
            >
              <Text style={styles.danger}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FocusGroup style={{ gap: 8 }}>
          <Field
            value={key}
            onChangeText={setKeyValue}
            placeholder="TypeSafe API key"
            secure
          />
          <Text style={styles.meta}>
            Stored encrypted on the server and never shown again. Saving sends
            one tiny test request.
          </Text>
          {keyError ? <Text style={styles.error}>{keyError}</Text> : null}
          <PrimaryButton
            label={setKey.isPending ? "Checking…" : "Save key"}
            disabled={key.trim().length < 8 || setKey.isPending}
            onPress={() => {
              setKeyError(null);
              setKey.mutate(key.trim(), {
                onSuccess: () => {
                  Keyboard.dismiss();
                  setKeyValue("");
                  setEditing(false);
                },
                onError: (err) =>
                  setKeyError(errorMessage(err, "Could not save the key.")),
              });
            }}
          />
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openURL(TYPESAFE_KEY_URL)}
            >
              <Text style={styles.link}>Get a key</Text>
            </Pressable>
            {typesafe.keySet || data.openrouterKeySet ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Keyboard.dismiss();
                  setKeyError(null);
                  setKeyValue("");
                  setEditing(false);
                }}
              >
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>
        </FocusGroup>
      )}
      {data.available ? <DeepWorkTimeField value={data.deepWorkTime ?? ""} /> : null}
      {data.available ? <UseCaseField /> : null}
      {data.available ? <LearnedDefaults /> : null}
    </View>
  );
}

const DEEP_WORK_TIMES: { value: DeepWorkTime; label: string }[] = [
  { value: "", label: "No preference" },
  { value: "morning", label: "Mornings" },
  { value: "afternoon", label: "Afternoons" },
  { value: "evening", label: "Evenings" },
];

/** The person's best time of day for deep work; task hints suggest planning
 * deep focus work then. */
function DeepWorkTimeField({ value }: { value: DeepWorkTime }) {
  const save = useSetDeepWorkTime();
  const [open, setOpen] = useState(false);
  const current = DEEP_WORK_TIMES.find((option) => option.value === value) ?? DEEP_WORK_TIMES[0];
  return (
    <View style={{ gap: 6 }} testID="deep-work-time">
      <Text style={styles.label}>Best time for deep work</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Best time for deep work: ${current.label}`}
        onPress={() => setOpen(true)}
        disabled={save.isPending}
        style={styles.picker}
      >
        <Text style={[styles.pickerValue, { flex: 1 }]} numberOfLines={1}>
          {current.label}
        </Text>
        {save.isPending ? (
          <LogoSpinner size={16} color={colors.mutedForeground} />
        ) : (
          <ChevronDown size={16} color={colors.mutedForeground} />
        )}
      </Pressable>
      <Text style={styles.meta}>Deep focus tasks get a hint to plan them at this time of day.</Text>
      {save.error ? <Text style={styles.error}>{errorMessage(save.error, "Could not save.")}</Text> : null}
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Best time for deep work">
        {DEEP_WORK_TIMES.map((option) => (
          <SheetOption
            key={option.value || "none"}
            selected={option.value === current.value}
            onSelect={() => {
              setOpen(false);
              if (option.value !== current.value) save.mutate(option.value);
            }}
          >
            {option.label}
          </SheetOption>
        ))}
      </BottomSheet>
    </View>
  );
}

/** What the person uses Timely for, in their own words. Workspace settings
 * suggest starter labels that fit it. */
function UseCaseField() {
  const prefs = usePersonalPrefsQuery();
  const save = useSaveUseCase();
  const saved = prefs.data?.prefs.useCase ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  return (
    <FocusGroup style={{ gap: 8 }} testID="use-case">
      <Text style={styles.label}>What you use Timely for</Text>
      <Field value={value} onChangeText={setDraft} placeholder="Running a bakery and studying design" />
      {value.trim() !== saved ? (
        <PrimaryButton
          label={save.isPending ? "Saving…" : "Save"}
          disabled={save.isPending}
          onPress={() => {
            Keyboard.dismiss();
            save.mutate(value.trim(), { onSuccess: () => setDraft(null) });
          }}
        />
      ) : null}
      {save.error ? <Text style={styles.error}>{errorMessage(save.error, "Could not save.")}</Text> : null}
    </FocusGroup>
  );
}

/** A feature's name, or its key in words when it has none yet. */
function learnedName(feature: string) {
  const words = feature.replace(/_/g, " ");
  return LEARNED_NAMES[feature] ?? words.charAt(0).toUpperCase() + words.slice(1);
}

/** Names for the features that learn from what the person keeps. */
const LEARNED_NAMES: Record<string, string> = {
  clarify: "Clarify form",
  doc_mention: "Link selection to an item",
  project_template: "Start from a template",
  sheet_template: "Sheet templates",
  doc_template: "Doc templates",
  chat_target: "Which item a chat change means",
  chat_context: "Attached items in chat",
  doc_passages: "Long doc reads",
  sheet_cell_fit: "Sheet entry checks",
  goal_progress: "Work toward goals",
  estimate: "Suggested length",
  import_format: "Plain-text import",
  search_related: "Related lists",
  search: "Search",
  screen_tip: "Screen tips",
  chat_prompts: "Chat example prompts",
  starter_labels: "Starter labels",
  today: "Today suggestions",
  task_hints: "Task hints",
  stale_work: "Stale work",
  project_insights: "Project insights",
  project_move: "Move to project",
  taxonomy_cleanup: "Merge suggestions",
  doc_hints: "Doc suggestions",
  receipt: "Receipts",
  smart_alerts: "Smart alerts",
  dashboard_highlights: "Dashboard highlights",
};

/** How often the person kept each feature's suggestions. A feature whose
 * suggestions were mostly changed now waits until it is surer. */
function LearnedDefaults() {
  const learned = useLearnedQuery();
  const reset = useResetLearned();
  const rows = learned.data?.features ?? [];
  if (!rows.length) return null;
  return (
    <View style={{ gap: 6 }} testID="decisions-learned">
      <Text style={styles.label}>What suggestions learned</Text>
      <Text style={styles.meta}>
        When you change most of a feature’s suggestions, it suggests only when it is surer.
      </Text>
      {rows.map((row) => (
        <View key={row.feature} style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={[styles.meta, { flex: 1 }]}>
            {learnedName(row.feature)} · kept {row.kept} of {row.decided}
            {row.raise > 0 ? " · asks for more certainty" : ""}
          </Text>
          {row.raise > 0 ? (
            <Pressable accessibilityRole="button" disabled={reset.isPending} onPress={() => reset.mutate(row.feature)}>
              <Text style={styles.link}>Reset</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const CUSTOM_ENDPOINT = "custom";

/** Which provider runs new chats and the writing tools. Nothing is picked on
 * the person's behalf: until they choose, those features wait (ADR 0020). */
function DefaultProviderGroup({ data }: { data: AgentProviders }) {
  const patch = usePatchAgentProviders();
  const ready = readyIds(data);
  const chosen = data.defaultChosen ? data.defaultProvider : "";
  const options: SelectOption[] = ready.map((id) => ({ value: id, label: PROVIDER_LABELS[id] }));
  // A chosen provider that is not ready right now (signed out) stays named.
  if (chosen && !ready.includes(chosen))
    options.push({ value: chosen, label: PROVIDER_LABELS[chosen] });
  const saving = patch.isPending ? patch.variables?.defaultProvider : undefined;
  const value = saving ?? chosen;

  const hint = chosen
    ? "Runs new chats and Help me write."
    : ready.length
      ? "Chats and Help me write wait until you choose one."
      : "Add a key below, then choose it here.";

  return (
    <View testID="default-provider" style={{ gap: 6 }}>
      <ListGroup>
        <Select
          trigger="row"
          label="Default provider"
          placeholder="Not chosen"
          value={value}
          onChange={(next) => {
            if (patch.isPending || next === value) return;
            patch.mutate({ defaultProvider: next as ProviderId });
          }}
          options={options}
        />
      </ListGroup>
      {patch.error ? (
        <Text style={[styles.error, { marginHorizontal: 4 }]}>
          {errorMessage(patch.error, "Could not switch provider.")}
        </Text>
      ) : (
        <GroupHint>
          {saving !== undefined ? "Switching…" : hint}
        </GroupHint>
      )}
    </View>
  );
}

/** The direct API providers folded into one dropdown, so OpenRouter and Smart
 * suggestions stay the two keys people see first. */
function MoreApiKeys({
  data,
  ask,
}: {
  data: AgentProviders;
  ask: (req: ProviderRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const providers = data.apiProviders;
  const connected = providers.filter((view) => view.connected);
  const defaultView = providers.find((view) => view.id === data.defaultProvider);
  const summary = defaultView
    ? `${defaultView.label} runs new chats`
    : connected.length > 0
      ? connected.map((view) => view.label).join(", ")
      : providers.length > 3
        ? `${providers
            .slice(0, 3)
            .map((view) => view.label)
            .join(", ")} and ${providers.length - 3} more`
        : providers.map((view) => view.label).join(", ");

  if (providers.length === 0) return null;
  return (
    <View
      style={[styles.group, defaultView && styles.cardDefault]}
      testID="more-api-keys"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.groupHeader}
      >
        <View style={styles.groupIcon}>
          <KeyRound size={16} color={colors.mutedForeground} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.groupTitle}>More API keys</Text>
          <Text style={styles.groupMeta} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        {connected.length > 0 ? (
          <Badge tone="ok">{`${connected.length} connected`}</Badge>
        ) : null}
        {open ? (
          <ChevronUp size={18} color={colors.mutedForeground} />
        ) : (
          <ChevronDown size={18} color={colors.mutedForeground} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.groupBody}>
          <Text style={styles.hint}>
            Use a provider’s own API key instead of OpenRouter. Saving a key
            checks it; choosing a model or making it the default sends one tiny
            test request.
          </Text>
          {providers.map((view, index) => (
            <ApiProviderRow
              key={view.id}
              data={data}
              view={view}
              ask={ask}
              first={index === 0}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const BOT_KEY_SOURCE = "finnhub";
const FINNHUB_REGISTER_URL = "https://finnhub.io/register";

function botKeyMeta(view: SourceKeyView | undefined) {
  if (!view?.keySet) return "Not set";
  if (view.state === "refused") return "Finnhub refused it. Replace it.";
  return view.keyHint ? `Saved · ${view.keyHint}` : "Saved";
}

/**
 * Stock prices for bots: the free Finnhub key stock bots read US prices with.
 * Write-only, as on the web: the server checks the key with Finnhub before
 * saving it and only ever answers with its last four characters. Coming from
 * a bot's "Add a free Finnhub key" (`?open=bot-keys`), the sheet opens by
 * itself when there is no usable key.
 */
function BotSourceKeysGroup() {
  const keys = useSourceKeysQuery();
  const setKey = useSetSourceKey();
  const removeKey = useRemoveSourceKey();
  const params = useLocalSearchParams<{ open?: string }>();
  const view = keys.data?.find((row) => row.source === BOT_KEY_SOURCE);
  const usable = !!view?.keySet && view.state !== "refused";
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The link opens the sheet once, after the key row has loaded.
  const [linkSeen, setLinkSeen] = useState(false);
  if (params.open === BOT_KEYS_SECTION && keys.data && !linkSeen) {
    setLinkSeen(true);
    if (!usable) setOpen(true);
  }

  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
    setValue("");
    setError(null);
  };

  const save = () => {
    const key = value.trim();
    if (!key || setKey.isPending) return;
    setError(null);
    setKey.mutate(
      { source: BOT_KEY_SOURCE, key },
      {
        onSuccess: close,
        onError: (err) => setError(errorMessage(err, "Could not save the key.")),
      },
    );
  };

  const remove = async () => {
    setError(null);
    try {
      await removeKey.mutateAsync(BOT_KEY_SOURCE);
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not remove the key."));
    }
  };

  const meta = keys.isPending
    ? "Loading…"
    : keys.error
      ? errorMessage(keys.error, "Could not load the key.")
      : botKeyMeta(view);

  return (
    <View testID="bot-source-keys" style={{ gap: 6 }}>
      <GroupLabel>Stock prices for bots</GroupLabel>
      <ListGroup>
        <ListRow
          testID="bot-source-key-finnhub"
          title="Finnhub key"
          meta={meta}
          trailing={
            keys.error ? (
              <Button label="Retry" variant="ghost" size="sm" onPress={() => void keys.refetch()} />
            ) : undefined
          }
          onPress={keys.data ? () => setOpen(true) : undefined}
        />
      </ListGroup>
      <GroupHint>
        Free. Stock bots need it to read US prices from Finnhub. Crypto bots
        don’t. Timely never shows the key again.
      </GroupHint>
      <BottomSheet
        open={open}
        onClose={() => {
          if (!setKey.isPending) close();
        }}
        title="Finnhub key"
        subtitle={view?.keySet ? botKeyMeta(view) : "Stock prices for bots"}
        footer={
          <PrimaryButton
            testID="bot-source-key-save"
            label={setKey.isPending ? "Checking…" : "Save"}
            loading={setKey.isPending}
            disabled={!value.trim()}
            onPress={save}
          />
        }
      >
        <View style={{ gap: 10, paddingBottom: 12 }}>
          <Field
            testID="bot-source-key-input"
            value={value}
            onChangeText={(next) => {
              setValue(next);
              if (error) setError(null);
            }}
            accessibilityLabel="Finnhub key"
            placeholder={view?.keySet ? "Paste a new key to replace it" : "Paste your Finnhub key"}
            secure
            autoFocus
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.hint}>
            Saving checks the key with Finnhub first.{" "}
            <Text
              accessibilityRole="link"
              style={styles.inlineLink}
              onPress={() => void Linking.openURL(FINNHUB_REGISTER_URL)}
            >
              Get a free key
            </Text>
          </Text>
          {view?.keySet ? (
            <View style={{ alignItems: "flex-start" }}>
              <Button
                testID="bot-source-key-remove"
                label={removeKey.isPending ? "Removing…" : "Remove"}
                variant="destructive-ghost"
                size="sm"
                loading={removeKey.isPending}
                disabled={setKey.isPending}
                onPress={() => setConfirmRemove(true)}
              />
            </View>
          ) : null}
        </View>
        <ConfirmSheet
          open={confirmRemove}
          onClose={() => setConfirmRemove(false)}
          title="Remove your Finnhub key?"
          message="Stock bots stop reading prices until you add a key again. Each check without one counts as a strike."
          confirmLabel="Remove"
          onConfirm={remove}
        />
      </BottomSheet>
    </View>
  );
}

/** What the Disconnect confirm says. Removing the default provider moves chat
 * to the next one set up, so the confirm names it rather than switching
 * silently. */
function disconnectNote(data: AgentProviders, id: ProviderId) {
  const next = providerAfterRemoval(data, id);
  if (next === data.defaultProvider) return "The saved key is deleted.";
  if (!next)
    return "The saved key is deleted. Chat and the writing tools won’t work until you set up another provider.";
  return `The saved key is deleted. Chat and the writing tools will use ${PROVIDER_LABELS[next as ProviderId]} instead.`;
}

/** One direct API provider inside More API keys: a single line until opened. */
function ApiProviderRow({
  data,
  view,
  ask,
  first,
}: {
  data: AgentProviders;
  view: ApiProviderView;
  ask: (req: ProviderRequest) => void;
  first: boolean;
}) {
  const patch = usePatchAgentProviders();
  const setKey = useSetApiProviderKey();
  const removeKey = useRemoveApiProviderKey();
  const models = useProviderModelsQuery(view.id, undefined, view.connected);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(!view.connected);
  const [key, setKeyValue] = useState("");
  const matched = view.endpoints.find((item) => item.baseUrl === view.baseUrl);
  const [endpoint, setEndpoint] = useState(
    matched?.id ?? (view.customUrl ? CUSTOM_ENDPOINT : view.endpoints[0]?.id),
  );
  const [customUrl, setCustomUrl] = useState(matched ? "" : view.baseUrl);
  const [keyError, setKeyError] = useState<string | null>(null);
  const isDefault = data.defaultProvider === view.id;
  const showEndpoints = view.endpoints.length > 1 || view.customUrl;
  const baseUrl =
    endpoint === CUSTOM_ENDPOINT
      ? customUrl.trim()
      : view.endpoints.find((item) => item.id === endpoint)?.baseUrl;
  const endpointChanged = (baseUrl ?? "") !== view.baseUrl;
  const canSave =
    !setKey.isPending &&
    (key.trim().length >= 8 ||
      (view.connected && endpointChanged && key.trim() === "") ||
      (view.keyOptional && key.trim() === ""));

  return (
    <View
      style={first ? undefined : styles.providerRowDivider}
      testID={`provider-${view.id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.providerHead}
      >
        <Text style={styles.providerName} numberOfLines={1}>
          {view.label}
        </Text>
        {isDefault ? (
          <Badge tone="primary">Default</Badge>
        ) : view.connected ? (
          <Badge tone="ok">{view.keySet ? "Key saved" : "Connected"}</Badge>
        ) : null}
        <View style={{ flex: 1 }} />
        {!open ? (
          <Text style={styles.providerAction}>
            {view.connected ? "Manage" : view.keyOptional ? "Set up" : "Add key"}
          </Text>
        ) : null}
        {open ? (
          <ChevronUp size={16} color={colors.mutedForeground} />
        ) : (
          <ChevronDown size={16} color={colors.mutedForeground} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.providerBody}>
          <Text style={styles.meta}>{view.description}</Text>
          {removeKey.error ? (
            <Text style={styles.error}>
              {errorMessage(removeKey.error, "Could not remove the key.")}
            </Text>
          ) : null}
          {!editing ? (
            <View style={[styles.row, { flexWrap: "wrap", columnGap: 12 }]}>
              {view.keySet ? (
                <Badge tone="ok">Key saved {view.keyHint}</Badge>
              ) : (
                <Badge tone="muted">No key needed</Badge>
              )}
              {showEndpoints ? (
                <Badge tone="muted">{matched?.label ?? view.baseUrl}</Badge>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing(true)}
              >
                <Text style={styles.smallLink}>
                  {view.keySet ? "Replace" : "Change"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  ask({
                    kind: "remove",
                    id: view.id,
                    title: `Disconnect ${view.label}?`,
                    message: disconnectNote(data, view.id),
                    confirmLabel: "Disconnect",
                    onRemove: async () => {
                      await removeKey.mutateAsync(view.id);
                      setOpen(false);
                      setEditing(true);
                    },
                  })
                }
              >
                <Text style={styles.smallDanger}>Disconnect</Text>
              </Pressable>
            </View>
          ) : (
            <FocusGroup style={{ gap: 8 }}>
              {showEndpoints ? (
                <View style={{ gap: 4 }}>
                  <Text style={styles.label}>Endpoint</Text>
                  {view.endpoints.map((item) => (
                    <SheetOption
                      key={item.id}
                      selected={endpoint === item.id}
                      onSelect={() => setEndpoint(item.id)}
                    >
                      {item.label}
                    </SheetOption>
                  ))}
                  {view.customUrl ? (
                    <SheetOption
                      selected={endpoint === CUSTOM_ENDPOINT}
                      onSelect={() => setEndpoint(CUSTOM_ENDPOINT)}
                    >
                      Another address…
                    </SheetOption>
                  ) : null}
                </View>
              ) : null}
              {endpoint === CUSTOM_ENDPOINT ? (
                <Field
                  value={customUrl}
                  onChangeText={setCustomUrl}
                  placeholder="http://192.168.1.20:11434"
                  keyboardType="url"
                />
              ) : null}
              <Field
                value={key}
                onChangeText={setKeyValue}
                placeholder={
                  view.keySet
                    ? "Leave empty to keep the saved key"
                    : view.keyOptional
                      ? "API key (only for Ollama Cloud)"
                      : (view.keyPlaceholder ?? "API key")
                }
                secure
              />
              <Text style={styles.hint}>
                Stored encrypted on the server and never shown again. Saving
                checks the key with the provider.{" "}
                <Text
                  accessibilityRole="link"
                  style={styles.inlineLink}
                  onPress={() => void Linking.openURL(view.keyUrl)}
                >
                  Get a key
                </Text>
              </Text>
              {keyError ? <Text style={styles.error}>{keyError}</Text> : null}
              <View style={[styles.row, { gap: 12 }]}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    label={
                      setKey.isPending
                        ? "Checking…"
                        : view.connected
                          ? "Save"
                          : "Connect"
                    }
                    disabled={!canSave}
                    onPress={() => {
                      setKeyError(null);
                      setKey.mutate(
                        { id: view.id, key: key.trim(), baseUrl },
                        {
                          onSuccess: (next) => {
                            // Blur first: unmounting a focused input on Android
                            // moves focus to another field.
                            Keyboard.dismiss();
                            setKeyValue("");
                            setEditing(false);
                            // Nothing becomes the default on its own (ADR 0020).
                            if (!next.defaultChosen && readyIds(next).includes(view.id))
                              ask({ kind: "choose", initial: view.id });
                          },
                          onError: (err) =>
                            setKeyError(
                              errorMessage(err, "Could not save the key."),
                            ),
                        },
                      );
                    }}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    Keyboard.dismiss();
                    setKeyError(null);
                    if (view.connected) setEditing(false);
                    else setOpen(false);
                  }}
                >
                  <Text style={styles.smallLink}>Cancel</Text>
                </Pressable>
              </View>
            </FocusGroup>
          )}
          {view.connected ? (
            <ModelPicker
              label="Chat model"
              value={view.model}
              options={models.data}
              loading={models.isLoading}
              loadError={
                models.error
                  ? errorMessage(models.error, "Could not load models.")
                  : null
              }
              saving={
                patch.isPending &&
                patch.variables?.models?.[view.id] !== undefined
              }
              onSave={(model) =>
                patch.mutateAsync({ models: { [view.id]: model } })
              }
              allowCustom
            />
          ) : null}
          {!view.search ? (
            <Text style={styles.hint}>
              No web search with this provider: chats that have it switched on
              answer without it.
            </Text>
          ) : null}
          {view.connected && !isDefault ? (
            <Pressable
              accessibilityRole="button"
              disabled={!view.ready || patch.isPending}
              onPress={() => patch.mutate({ defaultProvider: view.id })}
              style={{ opacity: view.ready ? 1 : 0.5, alignSelf: "flex-start" }}
            >
              <Text style={styles.smallLink}>
                {patch.isPending && patch.variables?.defaultProvider === view.id
                  ? "Switching…"
                  : "Use as default"}
              </Text>
            </Pressable>
          ) : null}
          {patch.error && patch.variables?.defaultProvider === view.id ? (
            <Text style={styles.error}>
              {errorMessage(patch.error, "Could not switch provider.")}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function CliCard({
  id,
  data,
  view,
  ask,
}: {
  id: "claude" | "codex";
  data: AgentProviders;
  view: CliProviderView;
  ask: (req: ProviderRequest) => void;
}) {
  const patch = usePatchAgentProviders();
  const connect = useConnectProvider();
  const disconnect = useDisconnectProvider();
  const models = useProviderModelsQuery(
    id,
    undefined,
    view.connected || view.status.found,
  );
  const [connectError, setConnectError] = useState<string | null>(null);
  const status = view.status;
  const loginCommand = id === "claude" ? "claude auth login" : "codex login";
  const envVar = id === "claude" ? "CLAUDE_BIN" : "CODEX_BIN";

  return (
    <ProviderCard
      id={id}
      data={data}
      ready={view.ready}
      description={
        id === "claude"
          ? "Uses the Claude Code CLI and its sign-in on the server. Runs with every built-in tool disabled."
          : "Uses the Codex CLI and its sign-in on the server. Runs in a read-only sandbox with the shell disabled."
      }
    >
      <View style={[styles.row, { flexWrap: "wrap" }]}>
        {status.found ? (
          <Badge tone="ok">
            Found{status.version ? ` · ${status.version}` : ""}
          </Badge>
        ) : (
          <Badge tone="warn">Not found on the server</Badge>
        )}
        {status.found && status.loggedIn ? (
          <Badge tone="ok">
            Signed in{status.account ? ` · ${status.account}` : ""}
          </Badge>
        ) : null}
        {status.found && !status.loggedIn ? (
          <Badge tone="warn">Not signed in</Badge>
        ) : null}
        {view.connected ? <Badge tone="primary">Connected</Badge> : null}
      </View>
      {status.path ? (
        <Text style={styles.meta} numberOfLines={1}>
          {status.path}
        </Text>
      ) : null}
      {!status.found ? (
        <Text style={styles.meta}>
          Install the CLI for the OS user that runs the Timely API. If it lives
          somewhere unusual, set {envVar} in the server .env. The path cannot be
          set from here.
        </Text>
      ) : null}
      {status.found && !status.loggedIn ? (
        <Text style={styles.meta}>
          Run “{loginCommand}” in a terminal on the server, then press Connect.
        </Text>
      ) : null}
      <View style={[styles.row, { gap: 16 }]}>
        <Pressable
          accessibilityRole="button"
          disabled={connect.isPending}
          onPress={() => {
            setConnectError(null);
            connect.mutate(id, {
              // Nothing becomes the default on its own (ADR 0020): ask now.
              onSuccess: (next) => {
                if (!next.defaultChosen && readyIds(next).includes(id))
                  ask({ kind: "choose", initial: id });
              },
              onError: (err) =>
                setConnectError(errorMessage(err, "Could not connect.")),
            });
          }}
        >
          <Text style={styles.link}>
            {connect.isPending
              ? "Checking…"
              : view.connected
                ? "Reconnect"
                : "Connect"}
          </Text>
        </Pressable>
        {view.connected ? (
          <Pressable
            accessibilityRole="button"
            disabled={disconnect.isPending}
            onPress={() =>
              // The default asks which provider takes its place.
              data.defaultChosen && data.defaultProvider === id
                ? ask({
                    kind: "remove",
                    id,
                    title: `Disconnect ${PROVIDER_LABELS[id]}?`,
                    message: "Timely stops using its sign-in on the server.",
                    confirmLabel: "Disconnect",
                    onRemove: () => disconnect.mutateAsync(id),
                  })
                : disconnect.mutate(id)
            }
          >
            <Text style={styles.danger}>Disconnect</Text>
          </Pressable>
        ) : null}
      </View>
      {connectError ? <Text style={styles.error}>{connectError}</Text> : null}
      <ModelPicker
        label="Model"
        value={view.model}
        options={models.data}
        loading={models.isLoading}
        loadError={
          models.error
            ? errorMessage(models.error, "Could not load models.")
            : null
        }
        saving={
          patch.isPending &&
          patch.variables?.[id === "claude" ? "claudeModel" : "codexModel"] !==
            undefined
        }
        onSave={(model) =>
          patch.mutateAsync(
            id === "claude" ? { claudeModel: model } : { codexModel: model },
          )
        }
        allowCustom
      />
    </ProviderCard>
  );
}

export default function AgentSettings() {
  const insets = useSafeAreaInsets();
  const providers = useAgentProvidersQuery({ watchReindex: true });
  const decisions = useDecisionSettingsQuery();
  // Engine and Permissions; an older server without them shows neither.
  const chatSettings = useAgentChatSettingsQuery();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // Choosing the default after a setup, or its replacement on removal.
  const [providerRequest, setProviderRequest] = useState<ProviderRequest | null>(null);
  const data = providers.data;

  return (
    <Screen>
      <MobileHeader title="Agent" back large={false} />
      <FocusGroupScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 24 + insets.bottom,
          gap: 12,
        }}
      >
        <Text style={styles.meta}>
          Choose which model runs the assistant. New chats use the default
          provider and its model; a run already in progress finishes on the
          provider it started with.
        </Text>
        {providers.isLoading ? (
          <Text style={styles.meta}>Checking providers…</Text>
        ) : null}
        {providers.error ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.error}>
              {errorMessage(
                providers.error,
                "Could not load provider settings.",
              )}
            </Text>
            <PrimaryButton
              label="Retry"
              onPress={() => void providers.refetch()}
            />
          </View>
        ) : null}
        {data ? (
          <>
            <DefaultProviderGroup data={data} />
            {chatSettings.data ? (
              <>
                <EngineCard settings={chatSettings.data} />
                <PermissionsCard settings={chatSettings.data} />
                <LearnedRow agent={chatSettings.data.engine === "agent"} />
              </>
            ) : null}
            <OpenRouterCard data={data} ask={setProviderRequest} />
            {decisions.data ? (
              <SmartSuggestionsCard
                data={decisions.data}
                confirm={setConfirm}
              />
            ) : null}
            <MoreApiKeys data={data} ask={setProviderRequest} />
            <BotSourceKeysGroup />
            {data.localCli ? (
              <>
                <CliCard id="claude" data={data} view={data.claude} ask={setProviderRequest} />
                <CliCard id="codex" data={data} view={data.codex} ask={setProviderRequest} />
              </>
            ) : (
              <Text style={styles.meta}>
                Claude Code and Codex are turned off on this server
                (CHAT_LOCAL_CLI=off).
              </Text>
            )}
            <View style={styles.sub}>
              <Text style={styles.label}>Privacy</Text>
              <Text style={styles.meta}>
                With Claude Code, Codex or a direct API provider selected, text,
                images, receipts and web search all go to that provider under
                your own subscription or key.
                The zero-data-retention guarantee for private images applies
                only to OpenRouter. If the selected provider is unavailable, the
                run fails with a message — Timely never switches providers
                silently.
              </Text>
            </View>
          </>
        ) : null}
        {/* It has its own query: the Finnhub key (and ?open=bot-keys) still
            works when the provider list is loading or failed. */}
        {data ? null : <BotSourceKeysGroup />}
      </FocusGroupScrollView>
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => confirm?.onConfirm()}
      />
      {data ? (
        <ProviderSheet
          data={data}
          request={providerRequest}
          onClose={() => setProviderRequest(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDefault: { borderColor: `${colors.primary}66` },
  title: { color: colors.foreground, fontSize: 17, fontWeight: "600" },
  label: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  meta: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  sourceLine: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
  error: { color: colors.destructive, fontSize: 13 },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 18 },
  warning: { color: colors.warning, fontSize: 13 },
  link: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
    paddingVertical: 6,
  },
  danger: {
    color: colors.destructive,
    fontSize: 15,
    fontWeight: "600",
    paddingVertical: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: "600" },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickerValue: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  sub: { borderRadius: 16, backgroundColor: colors.muted, padding: 12, gap: 8 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  inlineLink: { color: colors.primary, fontWeight: "600" },
  smallLink: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
    paddingVertical: 4,
  },
  smallDanger: {
    color: colors.destructive,
    fontSize: 14,
    fontWeight: "600",
    paddingVertical: 4,
  },
  group: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  groupIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  groupTitle: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  groupMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 1 },
  groupBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 4,
  },
  providerRowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  providerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
  },
  providerName: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  providerAction: { color: colors.mutedForeground, fontSize: 13 },
  providerBody: { gap: 8, paddingBottom: 12 },
}));
