"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import ColorPicker from "@/app/_components/_ui/colorPicker";

export type NamedColorItem = {
  id: string;
  name: string;
  color: string;
  badge?: string;
};

type NamedColorEditorProps = {
  title: string;
  /** Singular noun for the "New … name" placeholder; derived from `title` when omitted. */
  noun?: string;
  description: string;
  items: NamedColorItem[];
  emptyLabel: string;
  onCreate: (item: { name: string; color: string }) => Promise<void>;
  onUpdate: (
    id: string,
    item: { name: string; color: string },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

const DEFAULT_COLOR = "#889096";

export default function NamedColorEditor({
  title,
  noun = title.toLowerCase().replace(/s$/, ""),
  description,
  items,
  emptyLabel,
  onCreate,
  onUpdate,
  onDelete,
}: NamedColorEditorProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_COLOR);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (item: NamedColorItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditColor(item.color || DEFAULT_COLOR);
    setError(null);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), color });
      setName("");
      setColor(DEFAULT_COLOR);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create item.");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) {
      setError("Name is required.");
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await onUpdate(id, { name: editName.trim(), color: editColor });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update item.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await onDelete(id);
      if (editingId === id) setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete item.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>

      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          items.map((item) => {
            const editing = editingId === item.id;
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-2 py-2"
              >
                {editing ? (
                  <>
                    <ColorPicker value={editColor} onChange={setEditColor} />
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
                    />
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleUpdate(item.id)}
                      className="cursor-pointer rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="cursor-pointer rounded-lg bg-secondary px-2 py-1.5 text-xs text-secondary-foreground hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color || DEFAULT_COLOR }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {item.name}
                    </span>
                    {item.badge && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        {item.badge}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Edit ${item.name}`}
                      onClick={() => startEdit(item)}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${item.name}`}
                      disabled={busyId === item.id}
                      onClick={() => handleDelete(item.id)}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ColorPicker value={color} onChange={setColor} />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={`New ${noun} name`}
          className="min-w-0 flex-1 rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
        />
        <button
          type="button"
          disabled={creating}
          onClick={handleCreate}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:opacity-60"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
