import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/app/utils/cn";

/**
 * Text inputs and the shared control surface. Select, DateField, TimeField and
 * Input triggers all use `controlClass`, so a row of mixed controls lines up.
 * Spec: docs/design-system.md#inputs.
 */
export type ControlSize = "sm" | "md" | "lg";

const controlSizes: Record<ControlSize, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-2.5 text-sm",
  lg: "h-9 px-3 text-sm",
};

export const controlSurface =
  "rounded-md border border-input bg-card text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-muted-foreground/40 focus:border-ring focus:ring-2 focus:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

/** The floating panel behind a dropdown menu, date picker or popover. */
export const popoverSurface =
  "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5";

/** One row in a dropdown menu. */
export const menuItemClass = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors";

export function controlClass(size: ControlSize = "md", className?: string) {
  return cn(controlSurface, controlSizes[size], className);
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = "md", className, ...rest }, ref) {
  return <input ref={ref} className={controlClass(size, cn("w-full min-w-0", className))} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return (
    <textarea ref={ref} className={cn(controlSurface, "min-h-20 w-full px-2.5 py-2 text-sm", className)} {...rest} />
  );
});

/**
 * A label, the control, then a hint or error. Pass a render function to get
 * the generated id for the control.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={typeof children === "function" ? id : undefined}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      {typeof children === "function" ? children(id) : children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
