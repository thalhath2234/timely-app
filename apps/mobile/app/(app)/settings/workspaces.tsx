import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { ListGroup, ListRow, Monogram } from "../../../components/settings/SettingsList";
import { NameSheet } from "../../../components/settings/WorkspaceSheets";
import { keys, useProjectsQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { createWorkspace } from "../../../lib/api/workspaces";
import { resolvedColor } from "../../../lib/entityColor";
import { createThemedStyleSheet } from "../../../lib/theme";

function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

export default function WorkspacesSettings() {
  const router = useRouter();
  const client = useQueryClient();
  const spaces = useWorkspacesQuery().data ?? [];
  const projects = useProjectsQuery().data ?? [];
  const [creating, setCreating] = useState(false);

  return (
    <Screen>
      <MobileHeader title="Workspaces" back />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text style={styles.intro}>Each workspace has its own statuses, labels, fields and projects.</Text>
        <ListGroup testID="workspaces-list">
          {spaces.map((w) => {
            const projectCount = projects.filter((project) => project.workspaceId === w.id).length;
            return (
              <ListRow
                key={w.id}
                title={w.name}
                meta={[
                  plural(projectCount, "project"),
                  plural((w.status ?? []).length, "status", "statuses"),
                  plural((w.lables ?? []).length, "label"),
                  plural((w.customFields ?? []).length, "field"),
                ].join(" · ")}
                leading={<Monogram name={w.name} color={resolvedColor(w.color, w.id)} />}
                onPress={() => router.push(`/(app)/settings/workspace/${w.id}`)}
              />
            );
          })}
          <ListRow key="__new" tone="add" title="New workspace" onPress={() => setCreating(true)} testID="workspaces-new" />
        </ListGroup>
      </ScrollView>
      <NameSheet
        open={creating}
        onClose={() => setCreating(false)}
        title="New workspace"
        label="Name"
        placeholder="Studio, Personal, Side projects…"
        submitLabel="Create workspace"
        onSubmit={async (name) => {
          const workspace = await createWorkspace({ name });
          await client.invalidateQueries({ queryKey: keys.workspaces });
          if (workspace?.id) router.push(`/(app)/settings/workspace/${workspace.id}`);
        }}
      >
        <Text style={styles.hint}>It starts with Timely's default statuses; you can change them next.</Text>
      </NameSheet>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  intro: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, marginHorizontal: 4 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginHorizontal: 2 },
}));
