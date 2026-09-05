import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MoreHorizontal, Sheet as SheetIcon, Smile, Star, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import EmptyState from "../../../components/ui/EmptyState";
import SheetGrid from "../../../components/sheets/SheetGrid";
import { useDeleteSheet, useSheetQuery, useSheetsQuery, useUpdateSheet, useWorkspacesQuery } from "../../../lib/hooks";
import { saveStatusLabel, useAutosave } from "../../../lib/autosave";
import { normalizeSheet, routeParam, SHEET_ICON_CHOICES } from "../../../lib/sheet";
import { timeAgo } from "../../../lib/format";
import type { UpdateSheetPayload } from "../../../lib/api/sheets";
import type { Sheet, SheetColumn, SheetRow } from "../../../lib/types";
import { colors } from "../../../lib/theme";

type GridState = { columns: SheetColumn[]; rows: SheetRow[] };

export default function SheetDetailScreen() {
  const id = routeParam(useLocalSearchParams<{ id: string | string[] }>().id);
  const sheetQ = useSheetQuery(id);
  const listSheet = (useSheetsQuery().data ?? []).find((item) => item.id === id);
  const raw = sheetQ.data ?? listSheet;
  const loading = !raw && (sheetQ.isPending || sheetQ.isLoading || sheetQ.isFetching);

  if (!id || (!raw && loading)) {
    return (
      <Screen>
        <MobileHeader title="Sheet" back large={false} />
        <EmptyState icon={SheetIcon} title="Opening sheet" description="Loading this table…" />
      </Screen>
    );
  }

  if (!raw) {
    return (
      <Screen>
        <MobileHeader title="Sheet" back large={false} />
        <EmptyState icon={SheetIcon} title="Sheet not found" description="It may have been deleted." />
      </Screen>
    );
  }

  return <SheetEditor key={raw.id} sheet={normalizeSheet(raw)} />;
}

function SheetEditor({ sheet }: { sheet: Sheet }) {
  const router = useRouter();
  const spaces = useWorkspacesQuery().data ?? [];
  const save = useUpdateSheet();
  const remove = useDeleteSheet();

  const [title, setTitle] = useState(sheet.title);
  const [icon, setIcon] = useState(sheet.icon ?? "");
  const [favorite, setFavorite] = useState(sheet.isFavorite);
  const [description, setDescription] = useState(sheet.description ?? "");
  const [grid, setGrid] = useState<GridState>({ columns: sheet.columns, rows: sheet.rows });
  const [showDescription, setShowDescription] = useState(
    Boolean(sheet.description?.trim()) || Boolean(sheet.descriptionRich),
  );
  const [menu, setMenu] = useState<"more" | "icon" | "delete" | null>(null);

  const { schedule, flush, status } = useAutosave<UpdateSheetPayload>((patch) =>
    save.mutateAsync({ id: sheet.id, data: patch }),
  );

  const workspace = spaces.find((w) => w.id === sheet.workspaceId);

  function handleGridChange(next: Partial<GridState>) {
    const merged = {
      columns: next.columns ?? grid.columns,
      rows: next.rows ?? grid.rows,
    };
    setGrid(merged);
    schedule(merged);
  }

  return (
    <Screen>
      <MobileHeader
        title={workspace?.name || "Sheet"}
        subtitle={saveStatusLabel(status) || (sheet.updatedAt ? `Edited ${timeAgo(sheet.updatedAt)}` : undefined)}
        back
        large={false}
        actions={
          <View style={styles.actions}>
            <HeaderIconButton
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              active={favorite}
              onPress={() => {
                setFavorite(!favorite);
                schedule({ isFavorite: !favorite });
              }}
            >
              <Star size={20} color={favorite ? colors.warning : colors.mutedForeground} fill={favorite ? colors.warning : "transparent"} />
            </HeaderIconButton>
            <HeaderIconButton label="More" onPress={() => setMenu("more")}>
              <MoreHorizontal size={22} color={colors.foreground} />
            </HeaderIconButton>
          </View>
        }
      />

      <View style={styles.metaBlock}>
        <View style={styles.titleRow}>
          <Pressable accessibilityLabel="Change icon" onPress={() => setMenu("icon")} style={styles.iconBtn}>
            {icon ? <Text style={styles.icon}>{icon}</Text> : <Smile size={22} color={colors.mutedForeground} />}
          </Pressable>
          <TextInput
            value={title}
            placeholder="Untitled"
            placeholderTextColor={colors.mutedForeground}
            onChangeText={(value) => {
              setTitle(value);
              schedule({ title: value });
            }}
            onBlur={() => void flush()}
            style={styles.title}
          />
        </View>
        <Text style={styles.count}>
          {grid.rows.length} rows · {grid.columns.length} columns
          {!showDescription ? (
            <Text style={styles.addDesc} onPress={() => setShowDescription(true)}>
              {" · "}Add description
            </Text>
          ) : null}
        </Text>
        {showDescription ? (
          <TextInput
            value={description}
            onChangeText={(value) => {
              setDescription(value);
              schedule({ description: value });
            }}
            onBlur={() => void flush()}
            placeholder="Add a description…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={styles.description}
          />
        ) : null}
      </View>

      <View style={styles.gridWrap}>
        <SheetGrid columns={grid.columns} rows={grid.rows} onChange={handleGridChange} />
      </View>

      <BottomSheet open={menu === "more"} onClose={() => setMenu(null)} title="Sheet">
        <SheetOption onSelect={() => setMenu("icon")} leading={<Smile size={18} color={colors.foreground} />}>
          Change icon
        </SheetOption>
        {!showDescription ? (
          <SheetOption
            onSelect={() => {
              setShowDescription(true);
              setMenu(null);
            }}
          >
            Add description
          </SheetOption>
        ) : null}
        <SheetOption
          onSelect={() => setMenu("delete")}
          leading={<Trash2 size={18} color={colors.destructive} />}
        >
          Delete sheet
        </SheetOption>
      </BottomSheet>

      <BottomSheet open={menu === "icon"} onClose={() => setMenu(null)} title="Icon">
        <View style={styles.iconGrid}>
          {SHEET_ICON_CHOICES.map((choice) => (
            <Pressable
              key={choice}
              onPress={() => {
                setIcon(choice);
                schedule({ icon: choice });
                setMenu(null);
              }}
              style={[styles.iconChoice, choice === icon && styles.iconChoiceOn]}
            >
              <Text style={styles.icon}>{choice}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => {
            setIcon("");
            schedule({ icon: "" });
            setMenu(null);
          }}
          style={styles.removeIcon}
        >
          <Text style={styles.removeIconText}>Remove icon</Text>
        </Pressable>
      </BottomSheet>

      <BottomSheet open={menu === "delete"} onClose={() => setMenu(null)} title="Delete this sheet?">
        <View style={styles.deleteRow}>
          <Pressable onPress={() => setMenu(null)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => remove.mutate(sheet.id, { onSuccess: () => router.replace("/(app)/(tabs)/sheets") })}
            disabled={remove.isPending}
            style={styles.deleteBtn}
          >
            <Trash2 size={16} color="#fff" />
            <Text style={styles.deleteText}>{remove.isPending ? "Deleting…" : "Delete"}</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center" },
  metaBlock: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 26 },
  title: {
    flex: 1,
    color: colors.foreground,
    fontSize: 24,
    fontWeight: "600",
    paddingTop: 6,
    paddingBottom: 4,
  },
  count: { color: colors.mutedForeground, fontSize: 12, marginTop: 8 },
  addDesc: { color: colors.primary, fontWeight: "600" },
  description: {
    marginTop: 10,
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: "top",
  },
  gridWrap: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconChoiceOn: { backgroundColor: colors.accent },
  removeIcon: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  removeIconText: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  deleteRow: { flexDirection: "row", gap: 8, paddingTop: 4 },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  deleteBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.destructive,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  deleteText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
