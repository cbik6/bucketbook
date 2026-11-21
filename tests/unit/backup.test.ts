import { describe, expect, it } from "vitest";
import { backupPath, filesToPrune, isDue, localClock, readSettings } from "../../docker/backup.mjs";
import { summarizeBackupStatus } from "@/server/backup-status";

describe("backup settings", () => {
  it("defaults to 02:00, 14 backups and UTC", () => {
    expect(readSettings({})).toEqual({ time: "02:00", keep: 14, timeZone: "UTC" });
  });

  it("accepts a one-digit hour and a time zone", () => {
    expect(
      readSettings({ BACKUP_TIME: "3:30", BACKUP_KEEP_DAYS: "7", TZ: "America/Chicago" }),
    ).toEqual({ time: "03:30", keep: 7, timeZone: "America/Chicago" });
  });

  it("rejects a bad time or count", () => {
    expect(() => readSettings({ BACKUP_TIME: "25:00" })).toThrow(/BACKUP_TIME/);
    expect(() => readSettings({ BACKUP_TIME: "2am" })).toThrow(/BACKUP_TIME/);
    expect(() => readSettings({ BACKUP_KEEP_DAYS: "0" })).toThrow(/BACKUP_KEEP_DAYS/);
    expect(() => readSettings({ BACKUP_KEEP_DAYS: "1.5" })).toThrow(/BACKUP_KEEP_DAYS/);
  });
});

describe("backup schedule", () => {
  it("reads the clock in the configured time zone", () => {
    const now = new Date("2026-11-21T07:30:00Z");
    expect(localClock(now, "UTC")).toEqual({ date: "2026-11-21", time: "07:30" });
    expect(localClock(now, "America/Chicago")).toEqual({ date: "2026-11-21", time: "01:30" });
    expect(localClock(new Date("2026-11-21T03:00:00Z"), "America/Chicago")).toEqual({
      date: "2026-11-20",
      time: "21:00",
    });
  });

  it("runs once a day, at or after the set time", () => {
    expect(isDue({ date: "2026-11-21", time: "01:59" }, "02:00", "2026-11-20")).toBe(false);
    expect(isDue({ date: "2026-11-21", time: "02:00" }, "02:00", "2026-11-20")).toBe(true);
    expect(isDue({ date: "2026-11-21", time: "02:00" }, "02:00", "2026-11-21")).toBe(false);
    // Missed while the machine was off: runs when it comes back that day.
    expect(isDue({ date: "2026-11-21", time: "14:10" }, "02:00", "2026-11-19")).toBe(true);
    expect(isDue({ date: "2026-11-21", time: "02:30" }, "02:00", undefined)).toBe(true);
  });
});

describe("backup retention", () => {
  it("keeps the newest daily files and leaves everything else", () => {
    const names = [
      "bucketbook-2026-11-18.sql.gz",
      "bucketbook-2026-11-21.sql.gz",
      "bucketbook-2026-11-19.sql.gz",
      "bucketbook-2026-11-20.sql.gz",
      ".bucketbook-2026-11-22.sql.gz.partial",
      ".last-backup.json",
      "before-restore-20261121-101500.sql.gz",
      "my-copy.dump",
    ];
    expect(filesToPrune(names, 2)).toEqual([
      "bucketbook-2026-11-19.sql.gz",
      "bucketbook-2026-11-18.sql.gz",
    ]);
    expect(filesToPrune(names, 14)).toEqual([]);
  });
});

describe("restore file argument", () => {
  it("always resolves inside the backups folder", () => {
    expect(backupPath("/backups", "backups/bucketbook-2026-11-20.sql.gz")).toBe(
      "/backups/bucketbook-2026-11-20.sql.gz",
    );
    expect(backupPath("/backups", "./backups/x.sql.gz")).toBe("/backups/x.sql.gz");
    expect(backupPath("/backups", "x.dump")).toBe("/backups/x.dump");
    expect(backupPath("/backups", "../../etc/passwd")).toBe("/backups/passwd");
    expect(backupPath("/backups", "")).toBeNull();
    expect(backupPath("/backups", undefined)).toBeNull();
  });
});

describe("backup status in the health check", () => {
  const now = new Date("2026-11-21T12:00:00Z");

  it("is ok after a recent success", () => {
    expect(
      summarizeBackupStatus(
        {
          status: "ok",
          lastSuccess: "2026-11-21T08:00:03Z",
          lastAttempt: "2026-11-21T08:00:03Z",
          file: "bucketbook-2026-11-21.sql.gz",
        },
        now,
      ),
    ).toEqual({
      status: "ok",
      lastSuccess: "2026-11-21T08:00:03Z",
      lastAttempt: "2026-11-21T08:00:03Z",
      file: "bucketbook-2026-11-21.sql.gz",
      error: null,
    });
  });

  it("reports a failure with its message", () => {
    const s = summarizeBackupStatus(
      { status: "failed", lastAttempt: "2026-11-21T08:00:00Z", error: "disk full" },
      now,
    );
    expect(s.status).toBe("failed");
    expect(s.error).toBe("disk full");
  });

  it("is stale when the last success is more than two days old", () => {
    expect(
      summarizeBackupStatus({ status: "ok", lastSuccess: "2026-11-18T08:00:00Z" }, now).status,
    ).toBe("stale");
  });

  it("is none before the first run", () => {
    expect(summarizeBackupStatus({}, now).status).toBe("none");
    expect(summarizeBackupStatus(null, now).status).toBe("none");
  });
});
