"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ButtonSize, buttonClass } from "./button";

const HOLD_MS = 1000;

/**
 * Press and hold to confirm. A fill sweeps across the button while held
 * (clip-path, linear, so progress reads honestly) and snaps back quickly on
 * release. Works with mouse, touch, and keyboard (hold Space or Enter).
 * Used for consequential but reversible actions like archiving, instead of a
 * confirmation dialog.
 */
export function HoldButton({
  label,
  holdingLabel = "Keep holding",
  onConfirm,
  tone = "danger",
  size = "sm",
  disabled,
  className,
}: {
  label: string;
  holdingLabel?: string;
  onConfirm: () => void;
  tone?: "danger" | "signal";
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, []);

  const start = useCallback(() => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, HOLD_MS);
  }, [disabled, onConfirm]);

  useEffect(() => cancel, [cancel]);

  const fill = tone === "danger" ? "bg-negative-fill text-white" : "bg-signal text-on-signal";

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${label} (press and hold)`}
      className={buttonClass(
        tone === "danger" ? "danger" : "secondary",
        size,
        `overflow-hidden ${className ?? ""}`,
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") cancel();
      }}
      onBlur={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span>{label}</span>
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 flex items-center justify-center ${fill}`}
        style={{
          clipPath: holding ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
          transition: holding ? `clip-path ${HOLD_MS}ms linear` : "clip-path 200ms var(--ease-out)",
        }}
      >
        {holdingLabel}
      </span>
    </button>
  );
}
