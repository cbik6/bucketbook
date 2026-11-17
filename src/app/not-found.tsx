import Link from "next/link";
import { PlainShell } from "@/components/plain-shell";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PlainShell>
      <h1 className="mb-2 text-2xl font-semibold text-ink">Nothing here</h1>
      <p className="mb-8 text-ink-muted">
        That page or book doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/" className={buttonClass("secondary")}>
        Back to my books
      </Link>
    </PlainShell>
  );
}
