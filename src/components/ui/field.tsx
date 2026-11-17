import type { ComponentProps, ReactNode } from "react";

export const inputClass =
  "block h-10 w-full rounded-lg border border-field-border bg-surface px-3 text-sm text-ink " +
  "placeholder:text-ink-muted transition-[border-color,box-shadow] duration-150 " +
  "focus:border-[var(--focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]/25 " +
  "aria-invalid:border-negative disabled:bg-sunken disabled:text-ink-muted";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  optional,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-muted"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[0.8125rem] text-negative" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[0.8125rem] text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  invalid,
  className,
  ...props
}: ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      aria-describedby={props.id ? `${props.id}-${invalid ? "error" : "hint"}` : undefined}
      className={`${inputClass} ${className ?? ""}`}
      {...props}
    />
  );
}

export function SelectInput({
  invalid,
  className,
  children,
  ...props
}: ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={`${inputClass} appearance-none bg-[image:var(--select-chevron)] bg-[position:right_0.6rem_center] bg-no-repeat pr-9 ${className ?? ""}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-negative/40 bg-negative-soft px-3 py-2.5 text-sm text-negative"
    >
      {message}
    </div>
  );
}
