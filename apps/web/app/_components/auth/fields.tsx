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

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};

/** A labelled text field in the sign-in style; `hint` and `error` sit under it. */
export const AuthField = forwardRef<HTMLInputElement, InputProps>(
  function AuthField({ id, label, hint, error, className, ...input }, ref) {
    const note = error ?? hint;
    return (
      <div className={className}>
        <label
          htmlFor={id}
          className="mb-1.5 block text-[13px] font-medium text-[var(--lp-soft)]"
        >
          {label}
        </label>
        <div className="lp-field" data-invalid={error ? "" : undefined}>
          <input
            ref={ref}
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={note ? `${id}-note` : undefined}
            {...input}
          />
        </div>
        {note ? (
          <p
            id={`${id}-note`}
            className={cn(
              "mt-1.5 text-xs",
              error ? "text-[#ff8a80]" : "text-[var(--lp-soft)]",
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
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[13px] font-medium text-[var(--lp-soft)]"
      >
        {label}
      </label>
      <div className="lp-field">
        <input
          id={id}
          type={shown ? "text" : "password"}
          aria-describedby={hint ? `${id}-note` : undefined}
          {...input}
        />
        <button
          type="button"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown((value) => !value)}
          className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--lp-soft)] transition-colors hover:text-[var(--lp-ink)]"
        >
          {shown ? (
            <EyeOff className="size-[18px]" />
          ) : (
            <Eye className="size-[18px]" />
          )}
        </button>
      </div>
      {hint ? (
        <p id={`${id}-note`} className="mt-1.5 text-xs text-[var(--lp-soft)]">
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
