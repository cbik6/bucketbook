import fs from "node:fs/promises";
import { getEnv } from "@/server/env";

/**
 * The nightly backup's last outcome, as the backup service (docker/backup.mjs)
 * records it in backups/.last-backup.json.
 *
 * - "ok": the last run worked and is recent
 * - "failed": the last run failed (lastSuccess, if any, is the one before)
 * - "stale": the last success is more than two days old, so runs have stopped
 * - "none": the service is set up but hasn't run yet
 * - "off": no backup service (outside docker compose, or a docker-compose.yml from 1.0.1 or earlier)
 */
export type BackupHealth = {
  status: "ok" | "failed" | "stale" | "none" | "off";
  lastSuccess: string | null;
  lastAttempt: string | null;
  file: string | null;
  error: string | null;
};

const STALE_MS = 2 * 24 * 60 * 60 * 1000;

export function summarizeBackupStatus(raw: unknown, now: Date): BackupHealth {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  const lastSuccess = text(r.lastSuccess);
  const lastAttempt = text(r.lastAttempt);
  const base = { lastSuccess, lastAttempt, file: text(r.file), error: null };
  if (r.status === "failed") return { ...base, status: "failed", error: text(r.error) };
  if (!lastSuccess) return { ...base, status: "none" };
  const age = now.getTime() - new Date(lastSuccess).getTime();
  return { ...base, status: Number.isFinite(age) && age > STALE_MS ? "stale" : "ok" };
}

export async function backupHealth(now = new Date()): Promise<BackupHealth> {
  let file: string | undefined;
  try {
    file = getEnv().BACKUP_STATUS_FILE;
  } catch {
    // A configuration problem is reported by startup; health still answers.
  }
  if (!file) {
    return { status: "off", lastSuccess: null, lastAttempt: null, file: null, error: null };
  }
  let raw: unknown = {};
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    // Not written yet (or unreadable): reported as "none".
  }
  return summarizeBackupStatus(raw, now);
}
