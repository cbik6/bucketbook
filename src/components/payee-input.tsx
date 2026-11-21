"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { inputClass } from "@/components/ui/field";

/**
 * A payee field: type a name, or pick one from the book's Payees list as you
 * type. A name that isn't on the list yet is added to it when the entry is
 * saved, so there's nothing extra to click.
 */
export function PayeeInput({
  id,
  name,
  value,
  onChange,
  payees,
  label,
  placeholder,
  disabled,
  invalid,
  className,
  autoFocus,
  onBlur,
  onKeyDown,
  size = "regular",
}: {
  id?: string;
  /** For a plain form post: the field's name. */
  name?: string;
  value: string;
  onChange: (value: string) => void;
  /** The book's payee names. */
  payees: string[];
  /** For an input whose visible label isn't wrapped around it. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  autoFocus?: boolean;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** "row": the shorter field that fits in a review row. */
  size?: "regular" | "row";
}) {
  const typed = value.trim().toLowerCase();
  const isNew = typed.length > 0 && !payees.some((p) => p.toLowerCase() === typed);
  return (
    <Autocomplete.Root
      items={payees}
      value={value}
      onValueChange={(v) => onChange(v)}
      limit={8}
      name={name}
      disabled={disabled}
    >
      <Autocomplete.Input
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        maxLength={200}
        autoComplete="off"
        autoFocus={autoFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={`${inputClass} ${size === "row" ? "h-9 text-[0.8125rem]" : ""} ${className ?? ""}`}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} align="start" className="z-50 outline-none">
          <Autocomplete.Popup
            data-payee-popup=""
            className="max-h-[min(20rem,var(--available-height))] w-[max(var(--anchor-width),14rem)] max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] overflow-y-auto rounded-xl border border-rule bg-surface p-1 shadow-[var(--shadow-float)] outline-none transition-[scale,opacity] duration-150 ease-out data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0"
          >
            <Autocomplete.Empty>
              {isNew ? (
                <p className="px-2.5 py-2 text-[0.8125rem] text-ink-muted">
                  &ldquo;{value.trim()}&rdquo; is added to your payees when you save.
                </p>
              ) : null}
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(payee: string) => (
                <Autocomplete.Item
                  key={payee}
                  value={payee}
                  className="flex min-h-9 cursor-default select-none items-center rounded-md px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-sunken"
                >
                  <span className="min-w-0 flex-1 truncate">{payee}</span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
