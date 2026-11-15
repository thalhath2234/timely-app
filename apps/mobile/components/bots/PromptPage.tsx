import { useState } from "react";
import { Field } from "../ui/primitives";
import { GroupHint } from "../settings/SettingsList";
import { SavePage } from "./SavePage";

/** The Bot's prompt: what it does on every run, in the person's words. */
export function PromptPage({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: string;
  onSave: (prompt: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const clean = value.trim();
  return (
    <SavePage
      open={open}
      title="Prompt"
      canSave={clean.length > 0 && clean !== initial.trim()}
      onSave={() => onSave(clean)}
      onClose={onClose}
    >
      <Field
        label="What it does each run"
        value={value}
        onChangeText={setValue}
        multiline
        autoGrow
        autoCapitalize="sentences"
        maxLength={8000}
        placeholder="Watch this page and tell me when the price drops. Stay silent otherwise."
      />
      <GroupHint>It runs this on its schedule and tells you only what is worth your time.</GroupHint>
    </SavePage>
  );
}
