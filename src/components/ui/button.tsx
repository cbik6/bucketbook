import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium " +
  "transition-[scale,background-color,border-color,color] duration-150 ease-out " +
  "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  // Tailwind's hover: already applies only on devices that can hover.
  primary: "bg-signal text-on-signal hover:bg-signal-strong",
  secondary: "border border-field-border bg-surface text-ink hover:border-ink-muted",
  ghost: "text-ink-muted hover:bg-sunken hover:text-ink",
  danger: "border border-field-border bg-surface text-negative hover:border-negative",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[0.8125rem]",
  md: "h-10 px-4 text-sm",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra = "",
) {
  return [base, variants[variant], sizes[size], extra].filter(Boolean).join(" ");
}

export type IconButtonTone = "plain" | "raised" | "tint";

const iconTones: Record<IconButtonTone, string> = {
  plain: "text-ink-muted hover:bg-sunken hover:text-ink",
  // On a row that is already sunken while hovered.
  raised: "text-ink-muted hover:bg-surface hover:text-ink",
  // On a colored card: follows the card's ink.
  tint: "opacity-70 hover:bg-black/5 hover:opacity-100",
};

/** The one square icon-only control: sm is 32px, md is 36px. */
export function iconButtonClass({
  size = "md",
  tone = "plain",
  extra = "",
}: { size?: ButtonSize; tone?: IconButtonTone; extra?: string } = {}) {
  return [
    "inline-grid shrink-0 place-items-center rounded-lg",
    "transition-[background-color,color,opacity,scale] duration-150 ease-out active:scale-[0.95]",
    "disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "size-8" : "size-9",
    iconTones[tone],
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

type IconButtonProps = ComponentProps<"button"> & {
  "aria-label": string;
  size?: ButtonSize;
  tone?: IconButtonTone;
};

export function IconButton({ size, tone, className, type = "button", ...props }: IconButtonProps) {
  return (
    <button type={type} className={iconButtonClass({ size, tone, extra: className })} {...props} />
  );
}

/**
 * Shows the pending label in place of the usual one. Both stay laid out in the
 * same cell, so the button keeps the width of the wider label and never jumps.
 */
export function PendingLabel({
  pending,
  label,
  children,
}: {
  pending: boolean;
  label: ReactNode;
  children: ReactNode;
}) {
  const cell = "col-start-1 row-start-1 inline-flex items-center justify-center gap-2";
  return (
    <span className="grid">
      <span className={`${cell} ${pending ? "invisible" : ""}`}>{children}</span>
      <span className={`${cell} ${pending ? "" : "invisible"}`}>{label}</span>
    </span>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** While true the button is disabled and shows pendingLabel. */
  pending?: boolean;
  pendingLabel?: ReactNode;
};

export function Button({
  variant,
  size,
  className,
  type = "button",
  pending = false,
  pendingLabel,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pendingLabel === undefined ? (
        children
      ) : (
        <PendingLabel pending={pending} label={pendingLabel}>
          {children}
        </PendingLabel>
      )}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
