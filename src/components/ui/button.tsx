import Link from "next/link";
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium " +
  "transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] " +
  "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-signal text-on-signal [@media(hover:hover)]:hover:bg-signal-strong",
  secondary:
    "border border-rule-strong bg-surface text-ink [@media(hover:hover)]:hover:border-ink-faint",
  ghost:
    "text-ink-muted [@media(hover:hover)]:hover:bg-sunken [@media(hover:hover)]:hover:text-ink",
  danger:
    "border border-rule-strong bg-surface text-negative [@media(hover:hover)]:hover:border-negative",
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

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
