import { APP_NAME } from "@/lib/app-config";

/** The mark: a bucket outline with a pale yellow fill line. Pure geometry. */
export function BucketMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M4.5 6.5h15l-1.6 12.2a2 2 0 0 1-2 1.8H8.1a2 2 0 0 1-2-1.8L4.5 6.5Z"
        fill="currentColor"
        opacity="0.14"
      />
      <path
        d="M5.6 13.5h12.8l-.75 5.2a2 2 0 0 1-2 1.8H8.35a2 2 0 0 1-2-1.8l-.75-5.2Z"
        fill="var(--mark-fill)"
      />
      <path
        d="M4.5 6.5h15l-1.6 12.2a2 2 0 0 1-2 1.8H8.1a2 2 0 0 1-2-1.8L4.5 6.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M7 6.5a5 3.2 0 0 1 10 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-semibold tracking-[-0.02em] ${className ?? ""}`}
    >
      <BucketMark />
      <span>{APP_NAME}</span>
    </span>
  );
}
