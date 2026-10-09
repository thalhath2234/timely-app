import { useMemo, useState, type ReactNode } from "react";
import {
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown, Eye } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet, {
  type ConfirmRequest,
} from "../../../components/ui/ConfirmSheet";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
import {
  useAgentProvidersQuery,
  useConnectProvider,
  useDecisionSettingsQuery,
  useDisconnectProvider,
  usePatchAgentProviders,
  usePatchDecisionSettings,
  useProviderModelsQuery,
  useRemoveApiProviderKey,
  useRemoveOpenRouterKey,
  useRemoveTypeSafeKey,
  useSetApiProviderKey,
  useSetOpenRouterKey,
  useSetTypeSafeKey,
} from "../../../lib/hooks";
import type { DecisionSettings } from "../../../lib/api/decisions";
import {
  PROVIDER_LABELS,
  type AgentProviders,
  type ApiProviderView,
  type CliProviderView,
  type ModelOption,
  type ProviderId,
} from "../../../lib/api/agentProviders";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { LogoSpinner } from "../../../components/ui/TimelyLogo";

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
            Use “{query.trim()}”
          </SheetOption>
        ) : null}
        {filtered.map((option) => (
          <SheetOption
            key={option.id}
            selected={option.id === value}
            leading={
              option.vision ? (
                <Eye size={14} color={colors.mutedForeground} />
              ) : undefined
            }
            onSelect={() => void save(option.id)}
          >
            {option.name}
            {option.id !== option.name ? `  ·  ${option.id}` : ""}
            {option.note ? `  ·  ${option.note}` : ""}
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
  confirm,
}: {
  data: AgentProviders;
  confirm: (req: ConfirmRequest) => void;
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
                confirm({
                  title: "Remove your OpenRouter key?",
                  message: "OpenRouter chats and semantic search stop until you add one again.",
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
        <View style={{ gap: 8 }}>
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
                onSuccess: () => {
                  setKeyValue("");
                  setEditing(false);
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
        </View>
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
              Rebuilding search index… {reindex.done}
              {reindex.total ? ` / ${reindex.total}` : ""}
            </Text>
          </View>
        ) : null}
        {reindex.status === "done" ? (
          <Text style={styles.meta}>
            Search index up to date ({reindex.total} items).
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

/** Smart suggestions for Inbox items. Uses the TypeSafe key first, then the
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
  const typesafe = data.typesafe;
  const [editing, setEditing] = useState(!typesafe.keySet);
  const [key, setKeyValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  // The server names a provider only while switched on; derive it otherwise
  // so the line still says which key would be used.
  const provider =
    data.provider ??
    (typesafe.keySet && !typesafe.rejected
      ? "typesafe"
      : data.openrouterKeySet
        ? "openrouter"
        : undefined);

  return (
    <View style={styles.card} testID="smart-suggestions">
      <View style={styles.row}>
        <Text style={[styles.title, { flex: 1 }]}>Smart suggestions</Text>
        <Switch
          accessibilityLabel="Smart suggestions"
          value={data.enabled}
          disabled={patch.isPending}
          onValueChange={(enabled) => patch.mutate(enabled)}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <Text style={styles.meta}>
        Suggests fields when you clarify Inbox items, points you to an earlier
        chat about the same thing and flags agent changes worth a check. For
        receipts it picks a category and sheet you already use and notes
        likely repeats, and it types the columns of an imported CSV from a
        few of its values. Receipt photos and receipt amounts are never sent.
        Uses TypeSafe’s Jev model.
      </Text>
      <Text style={styles.meta}>
        {provider === "typesafe"
          ? "Using your TypeSafe key"
          : provider === "openrouter"
            ? "Using your OpenRouter key"
            : "Add a TypeSafe or OpenRouter key to turn this on"}
      </Text>
      {patch.error ? (
        <Text style={styles.error}>
          {errorMessage(patch.error, "Could not change this setting.")}
        </Text>
      ) : null}
      <Text style={styles.label}>TypeSafe API key</Text>
      {typesafe.rejected ? (
        <Text style={styles.warning}>
          TypeSafe refused this key. Replace it to use TypeSafe again.
        </Text>
      ) : null}
      {!editing ? (
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {typesafe.keySet ? (
            <Badge tone={typesafe.rejected ? "warn" : "ok"}>
              Key saved {typesafe.keyHint}
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
        <View style={{ gap: 8 }}>
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
          {typesafe.keySet ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                Keyboard.dismiss();
                setKeyError(null);
                setEditing(false);
              }}
            >
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const CUSTOM_ENDPOINT = "custom";

/** A direct API provider, rendered from the server's catalog. Until a key is
 * saved it stays one compact row. */
function ApiProviderCard({
  data,
  view,
  confirm,
}: {
  data: AgentProviders;
  view: ApiProviderView;
  confirm: (req: ConfirmRequest) => void;
}) {
  const patch = usePatchAgentProviders();
  const setKey = useSetApiProviderKey();
  const removeKey = useRemoveApiProviderKey();
  const models = useProviderModelsQuery(view.id, undefined, view.connected);
  const [opened, setOpen] = useState(false);
  const open = opened || view.connected;
  const [editing, setEditing] = useState(!view.connected);
  const [key, setKeyValue] = useState("");
  const matched = view.endpoints.find((item) => item.baseUrl === view.baseUrl);
  const [endpoint, setEndpoint] = useState(
    matched?.id ?? (view.customUrl ? CUSTOM_ENDPOINT : view.endpoints[0]?.id),
  );
  const [customUrl, setCustomUrl] = useState(matched ? "" : view.baseUrl);
  const [keyError, setKeyError] = useState<string | null>(null);
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

  if (!open) {
    return (
      <View style={styles.card} testID={`provider-${view.id}`}>
        <Text style={styles.title}>{view.label}</Text>
        <Text style={styles.meta}>{view.description}</Text>
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
          <Text style={styles.link}>
            {view.keyOptional ? "Set up" : "Add key"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ProviderCard
      id={view.id}
      data={data}
      ready={view.ready}
      description={view.description}
    >
      {!editing ? (
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          {view.keySet ? (
            <Badge tone="ok">Key saved {view.keyHint}</Badge>
          ) : (
            <Badge tone="muted">No key needed</Badge>
          )}
          {showEndpoints ? (
            <Badge tone="muted">{matched?.label ?? view.baseUrl}</Badge>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
            <Text style={styles.link}>{view.keySet ? "Replace" : "Change"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              confirm({
                title: `Disconnect ${view.label}?`,
                message: "The saved key is deleted.",
                confirmLabel: "Disconnect",
                onConfirm: () =>
                  removeKey.mutate(view.id, {
                    onSuccess: () => {
                      setOpen(false);
                      setEditing(true);
                    },
                  }),
              })
            }
          >
            <Text style={styles.danger}>Disconnect</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
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
          <Text style={styles.meta}>
            Stored encrypted on the server and never shown again. Saving checks
            the key with the provider.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(view.keyUrl)}
          >
            <Text style={styles.link}>Get a key</Text>
          </Pressable>
          {keyError ? <Text style={styles.error}>{keyError}</Text> : null}
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
                  onSuccess: () => {
                    // Blur first: unmounting a focused input on Android moves
                    // focus to another field.
                    Keyboard.dismiss();
                    setKeyValue("");
                    setEditing(false);
                  },
                  onError: (err) =>
                    setKeyError(errorMessage(err, "Could not save the key.")),
                },
              );
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              Keyboard.dismiss();
              setKeyError(null);
              if (view.connected) setEditing(false);
              else setOpen(false);
            }}
          >
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
        </View>
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
            patch.isPending && patch.variables?.models?.[view.id] !== undefined
          }
          onSave={(model) => patch.mutateAsync({ models: { [view.id]: model } })}
          allowCustom
        />
      ) : null}
      {!view.search ? (
        <Text style={styles.meta}>
          No web search with this provider: chats that have it switched on
          answer without it.
        </Text>
      ) : null}
    </ProviderCard>
  );
}

function CliCard({
  id,
  data,
  view,
}: {
  id: "claude" | "codex";
  data: AgentProviders;
  view: CliProviderView;
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
            onPress={() => disconnect.mutate(id)}
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
  const providers = useAgentProvidersQuery();
  const decisions = useDecisionSettingsQuery();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const data = providers.data;

  return (
    <Screen>
      <MobileHeader title="Agent" back large={false} />
      <ScrollView
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
            <OpenRouterCard data={data} confirm={setConfirm} />
            {decisions.data ? (
              <SmartSuggestionsCard
                data={decisions.data}
                confirm={setConfirm}
              />
            ) : null}
            <Text style={styles.label}>Direct API providers</Text>
            <Text style={styles.meta}>
              Use a provider’s own API key instead of OpenRouter. Saving a key
              checks it; choosing a model or making it the default sends one
              tiny test request.
            </Text>
            {data.apiProviders.map((view) => (
              <ApiProviderCard
                key={view.id}
                data={data}
                view={view}
                confirm={setConfirm}
              />
            ))}
            {data.localCli ? (
              <>
                <CliCard id="claude" data={data} view={data.claude} />
                <CliCard id="codex" data={data} view={data.codex} />
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
      </ScrollView>
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => confirm?.onConfirm()}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDefault: { borderColor: `${colors.primary}66` },
  title: { color: colors.foreground, fontSize: 17, fontWeight: "700" },
  label: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  meta: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  error: { color: colors.destructive, fontSize: 13 },
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
}));
