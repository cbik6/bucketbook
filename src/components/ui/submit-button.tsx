"use client";

import { useFormStatus } from "react-dom";
import { type ButtonSize, type ButtonVariant, buttonClass } from "./button";

/** A submit button that shows the pending state of its form. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
