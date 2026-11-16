import { useState } from "react";
import { Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react-native";
import { getLearnedSkills } from "../../lib/api/learning";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { GroupHint, ListGroup, ListRow } from "../settings/SettingsList";
import { SavePage } from "./SavePage";

/**
 * The skills the Bot's runs may load (a skill is a saved how-to). The list is
 * the account's enabled skills; a skill the Bot already has stays listed
 * even if it was turned off since.
 */
export function SkillsPage({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: string[];
  onSave: (skills: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [touched, setTouched] = useState(false);
  const skills = useQuery({ queryKey: ["agent-learning", "skills"], queryFn: getLearnedSkills, enabled: open, staleTime: 30_000 });
  const offered = (skills.data?.skills ?? []).filter((s) => !s.archived && (s.enabled || initial.includes(s.name)));
  const names = new Set(offered.map((s) => s.name));
  // A skill the Bot names that the account no longer lists still shows, so it can be taken off.
  const missing = initial.filter((name) => !names.has(name));
  const toggle = (name: string) => {
    setTouched(true);
    setPicked((now) => (now.includes(name) ? now.filter((n) => n !== name) : [...now, name]));
  };
  return (
    <SavePage open={open} title="Skills" canSave={touched} onSave={() => onSave(picked)} onClose={onClose}>
      {skills.isPending ? <Text style={styles.muted}>Loading skills…</Text> : null}
      {skills.error ? <Text style={styles.muted}>Couldn’t load your skills. Pull to try again.</Text> : null}
      {offered.length + missing.length > 0 ? (
        <ListGroup>
          {[...offered.map((s) => ({ name: s.name, meta: s.description })), ...missing.map((name) => ({ name, meta: "Not in your skills any more" }))].map(
            (skill) => (
              <ListRow
                key={skill.name}
                title={skill.name}
                meta={skill.meta}
                chevron={false}
                onPress={() => toggle(skill.name)}
                trailing={picked.includes(skill.name) ? <Check size={18} color={colors.primary} /> : undefined}
              />
            ),
          )}
        </ListGroup>
      ) : skills.isSuccess ? (
        <Text style={styles.muted}>No skills yet. Ones Timely saves from your chats show up here.</Text>
      ) : null}
      <GroupHint>A Bot only loads the skills ticked here. It never saves or changes skills itself.</GroupHint>
    </SavePage>
  );
}

const styles = createThemedStyleSheet(() => ({
  muted: { color: colors.mutedForeground, fontSize: 14 },
}));
