"use client";

import {
  forwardRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/app/utils/cn";
import Button from "@/app/_components/_ui/button";
import { Input } from "@/app/_components/_ui/field";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

// The shared Field look (docs/design-system.md#inputs) at the lg size that
// sits beside an lg button.
const labelClass = "mb-1.5 block text-xs font-medium text-muted-foreground";

/** A labelled text field; `hint` and `error` sit under it. */
export const AuthField = forwardRef<HTMLInputElement, InputProps>(
  function AuthField({ id, label, hint, error, className, ...input }, ref) {
    const note = error ?? hint;
    return (
      <div className={cn("lp-control", className)}>
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <Input
          ref={ref}
          id={id}
          size="lg"
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
          {...input}
        />
        {note ? (
          <p
            id={`${id}-note`}
            className={cn(
              "mt-1.5 text-xs",
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {note}
          </p>
        ) : null}
      </div>
    );
  },
);

/** A password field with a show/hide button. */
export function PasswordField({
  id,
  label,
  hint,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="lp-control">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          size="lg"
          type={shown ? "text" : "password"}
          aria-describedby={hint ? `${id}-note` : undefined}
          className="pr-10"
          {...input}
        />
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown((value) => !value)}
          className="absolute top-1/2 right-1 -translate-y-1/2"
        >
          {shown ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {hint ? (
        <p id={`${id}-note`} className="mt-1.5 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** An error or confirmation, drawn as a red or green calendar block and announced to screen readers. */
export function AuthNotice({
  tone = "error",
  children,
}: {
  tone?: "error" | "success";
  children: ReactNode;
}) {
  return (
    <motion.div
      role={tone === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="lp-notice px-3.5 py-2.5 text-sm text-[var(--lp-ink)]"
      style={
        tone === "success"
          ? ({ "--c": "var(--lp-green)" } as CSSProperties)
          : undefined
      }
    >
      {children}
    </motion.div>
  );
}

/** A toggle chip; picked chips become small calendar blocks. Pass `color` for a label dot. */
export function ChoiceChip({
  pressed,
  onClick,
  color,
  off,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  color?: string;
  off?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-off={off ? "" : undefined}
      onClick={onClick}
      className="lp-chip"
      style={color ? ({ "--c": color } as CSSProperties) : undefined}
    >
      {color ? <span className="lp-dot" /> : null}
      {children}
    </button>
  );
}
