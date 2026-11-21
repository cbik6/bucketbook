import Link from "next/link";
import type { BackupHealth } from "@/server/backup-status";

/**
 * The nightly database backup's state, for install admins (see docker/backup.mjs
 * and src/server/backup-status.ts). Server components: no client code needed.
 */

const DOCS = "https://github.com/cbik6/bucketbook/blob/main/docs/backup-restore.md";

function when(iso: string | null, timeZone: string) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

function timeLabel(hhmm: string | null) {
  if (!hhmm) return "2:00 AM";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h! % 12 === 0 ? 12 : h! % 12}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
}

/** A command on its own line, so it copies cleanly. */
function CommandLine({ children }: { children: string }) {
  return (
    <code className="block overflow-x-auto whitespace-pre rounded bg-surface px-2.5 py-1.5 text-[0.8125rem] text-ink">
      {children}
    </code>
  );
}

/** The Backups section of Book settings. */
export function BackupStatusPanel({
  health,
  timeZone,
}: {
  health: BackupHealth;
  timeZone: string;
}) {
  const lastGood = when(health.lastSuccess, timeZone);
  const schedule = `Every night at ${timeLabel(health.time)} (${timeZone}), keeping the newest ${health.keep ?? 14}, in the backups folder next to docker-compose.yml.`;

  if (health.status === "off") {
    return (
      <p className="max-w-prose text-sm">
        Nightly backups aren&apos;t set up on this install. Installs from 1.0.1 or earlier need
        their data moved into the Bucketbook folder first; see{" "}
        <a
          href={`${DOCS}#upgrading-from-101-or-earlier`}
          className="text-signal-ink underline underline-offset-2"
        >
          Upgrading from 1.0.1 or earlier
        </a>
        .
      </p>
    );
  }

  if (health.status === "failed" || health.status === "stale") {
    return (
      <div
        role="alert"
        className="flex max-w-prose flex-col gap-2 rounded-lg border border-negative/40 bg-negative-soft px-4 py-3 text-sm"
      >
        <p className="font-medium text-negative">
          {health.status === "failed"
            ? `The last backup failed${health.lastAttempt ? ` (${when(health.lastAttempt, timeZone)})` : ""}.`
            : "Backups have stopped: none in more than two days."}
        </p>
        {health.error ? <p className="text-ink">{health.error}</p> : null}
        <p className="text-ink">
          {lastGood ? `The last good backup is from ${lastGood}.` : "There is no good backup yet."}{" "}
          On the server, in the Bucketbook folder, see what happened:
        </p>
        <CommandLine>docker compose logs backup</CommandLine>
        <p className="text-ink">Then, once it&apos;s fixed, back up now:</p>
        <CommandLine>docker compose exec backup bucketbook-backup now</CommandLine>
      </div>
    );
  }

  return (
    <dl className="grid max-w-prose grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-sm">
      <dt className="text-ink-muted">Last backup</dt>
      <dd>
        {health.status === "none" ? (
          "None yet."
        ) : (
          <>
            {lastGood} <span className="text-positive">OK</span>
            {health.file ? <div className="text-ink-muted">{health.file}</div> : null}
          </>
        )}
      </dd>
      <dt className="text-ink-muted">Schedule</dt>
      <dd>{schedule}</dd>
    </dl>
  );
}

/** A banner across book pages for admins, only when backups are failing or stopped. */
export function BackupWarning({ health, bookId }: { health: BackupHealth; bookId: string }) {
  if (health.status !== "failed" && health.status !== "stale") return null;
  return (
    <div
      role="alert"
      className="border-b border-negative/40 bg-negative-soft px-5 py-2.5 text-sm text-negative lg:px-10"
    >
      {health.status === "failed"
        ? "The last database backup failed."
        : "Database backups have stopped: none in more than two days."}{" "}
      <Link
        href={`/books/${bookId}/settings#backups-heading`}
        className="font-medium underline underline-offset-2"
      >
        See Backups in Book settings
      </Link>
    </div>
  );
}
