#!/usr/bin/env node
// Bucketbook's database backups. Runs as the `backup` service in docker-compose.yml,
// from the same image as the app, so pg_dump always matches the bundled Postgres.
//
//   bucketbook-backup schedule        nightly at BACKUP_TIME (the service's default)
//   bucketbook-backup now             one backup right away
//   bucketbook-backup list            the backups in the folder
//   bucketbook-backup restore FILE    replace the database with FILE (stop the app first)
//
// From the bucketbook folder these are, for example:
//   docker compose exec backup bucketbook-backup now
//   docker compose run --rm backup restore backups/bucketbook-2026-11-20.sql.gz
//
// Backups are gzipped plain SQL, bucketbook-YYYY-MM-DD.sql.gz. Each is written to a
// hidden .partial file, checked, and only then renamed, so a backup tool never copies
// a half-written dump. The newest BACKUP_KEEP_DAYS daily files are kept; any other
// file in the folder is left alone. The outcome of the last run is written to
// .last-backup.json, which the app shows in /api/health.
//
// Plain Node with no dependencies, so it runs outside the Next.js build.

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const DAILY_FILE = /^bucketbook-(\d{4}-\d{2}-\d{2})\.sql\.gz$/;
export const STATUS_FILE = ".last-backup.json";
const DUMP_FOOTER = "-- PostgreSQL database dump complete";

// ---------------------------------------------------------------------------
// Pure helpers (unit tested in tests/unit/backup.test.ts)
// ---------------------------------------------------------------------------

/** Reads BACKUP_TIME ("HH:MM", 24-hour) and BACKUP_KEEP_DAYS, with defaults. */
export function readSettings(env) {
  const time = (env.BACKUP_TIME ?? "").trim() || "02:00";
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`BACKUP_TIME must look like 02:00 (24-hour), not "${time}"`);
  }
  const keepText = (env.BACKUP_KEEP_DAYS ?? "").trim() || "14";
  const keep = Number(keepText);
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`BACKUP_KEEP_DAYS must be a whole number of at least 1, not "${keepText}"`);
  }
  return {
    time: `${match[1].padStart(2, "0")}:${match[2]}`,
    keep,
    timeZone: (env.TZ ?? "").trim() || "UTC",
  };
}

/** The date ("YYYY-MM-DD") and time ("HH:MM") of `now` in a time zone. */
export function localClock(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Whether the schedule should back up now: once a day, at or after BACKUP_TIME.
 * "At or after" means a backup missed while the machine was off runs when it comes
 * back the same day, and a time skipped by a clock change still runs.
 */
export function isDue(clock, backupTime, lastAttemptDate) {
  return clock.time >= backupTime && lastAttemptDate !== clock.date;
}

/** Daily backup files to delete so only the newest `keep` remain. */
export function filesToPrune(names, keep) {
  return names
    .filter((n) => DAILY_FILE.test(n))
    .sort()
    .reverse()
    .slice(keep);
}

/**
 * Where a restore argument points inside the container. Accepts what people type
 * from the bucketbook folder ("backups/x.sql.gz", "./backups/x.sql.gz") or just the
 * file name; it always resolves inside the backups folder.
 */
export function backupPath(dir, arg) {
  const name = path.basename(String(arg ?? "").trim());
  if (!name || name === "." || name === "..") return null;
  return path.join(dir, name);
}

// ---------------------------------------------------------------------------
// Running pg_dump, psql and pg_restore
// ---------------------------------------------------------------------------

const DIR = process.env.BACKUP_PATH || "/backups";

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

/** Runs a command, optionally feeding stdin from a stream; resolves with stderr. */
function run(cmd, args, { input, output, quiet } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: [input ? "pipe" : "ignore", output ? "pipe" : quiet ? "ignore" : "inherit", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
    });
    const streams = [];
    if (input) streams.push(pipeline(input, child.stdin));
    if (output) streams.push(pipeline(child.stdout, ...output));
    const exited = new Promise((res) => child.on("close", (code) => res(code)));
    child.on("error", reject);
    Promise.all([exited, ...streams.map((s) => s.catch((e) => e))]).then(([code, ...errs]) => {
      const err = errs.find((e) => e instanceof Error);
      if (code !== 0) {
        reject(new Error(lastLine(stderr) || `${cmd} exited with code ${code}`));
      } else if (err) {
        reject(err);
      } else {
        resolve(stderr);
      }
    }, reject);
  });
}

function lastLine(text) {
  const lines = String(text).trim().split("\n").filter(Boolean);
  return lines.at(-1)?.slice(0, 300) ?? "";
}

async function psql(sql, database = process.env.PGDATABASE) {
  let out = "";
  await new Promise((resolve, reject) => {
    const child = spawn("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(lastLine(err)))));
  });
  return out.trim();
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Makes `file` belong to whoever owns the backups folder, so the host user can read it. */
async function giveToFolderOwner(file) {
  try {
    const { uid, gid } = await fs.stat(DIR);
    await fs.chown(file, uid, gid);
  } catch {
    // Not root, or a filesystem without ownership: leave it as written.
  }
}

/** Lets the app (another user) open .last-backup.json without listing the folder. */
async function allowStatusReads() {
  try {
    const { mode } = await fs.stat(DIR);
    if ((mode & 0o001) === 0) await fs.chmod(DIR, (mode & 0o7777) | 0o001);
  } catch {
    // Not ours to change; the app then reports the backup status as unknown.
  }
}

async function readStatus() {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, STATUS_FILE), "utf8"));
  } catch {
    return {};
  }
}

async function writeStatus(status) {
  const file = path.join(DIR, STATUS_FILE);
  const tmp = `${file}.partial`;
  await fs.writeFile(tmp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o644 });
  await fs.chmod(tmp, 0o644);
  await giveToFolderOwner(tmp);
  await fs.rename(tmp, file);
}

/** Checks a finished gzip dump: it decompresses cleanly and ends with pg_dump's footer. */
async function verifyDump(file) {
  let tail = "";
  const gunzip = zlib.createGunzip();
  gunzip.on("data", (chunk) => {
    tail = (tail + chunk.toString("utf8")).slice(-512);
  });
  await pipeline(createReadStream(file), gunzip);
  if (!tail.includes(DUMP_FOOTER)) {
    throw new Error("the dump is incomplete (pg_dump's closing line is missing)");
  }
}

async function fsyncPath(p, flags = "r") {
  const handle = await fs.open(p, flags);
  try {
    await handle.sync();
  } catch {
    // Some filesystems (and directories on them) can't be synced; the rename still is atomic.
  } finally {
    await handle.close();
  }
}

/** Dumps the database to `name` in the backups folder. Returns its size in bytes. */
async function dumpTo(name) {
  const final = path.join(DIR, name);
  const tmp = path.join(DIR, `.${name}.partial`);
  await fs.rm(tmp, { force: true });
  try {
    await run("pg_dump", ["--no-owner", "--no-privileges"], {
      output: [zlib.createGzip({ level: 6 }), createWriteStream(tmp, { mode: 0o600 })],
    });
    await verifyDump(tmp);
    await fsyncPath(tmp, "r+");
    await giveToFolderOwner(tmp);
    await fs.rename(tmp, final);
    await fsyncPath(DIR);
    return (await fs.stat(final)).size;
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

async function backup(settings) {
  const startedAt = new Date();
  const { date } = localClock(startedAt, settings.timeZone);
  const name = `bucketbook-${date}.sql.gz`;
  const previous = await readStatus();
  await allowStatusReads();
  try {
    const bytes = await dumpTo(name);
    const pruned = filesToPrune(await fs.readdir(DIR), settings.keep);
    for (const old of pruned) await fs.rm(path.join(DIR, old), { force: true });
    const finishedAt = new Date();
    await writeStatus({
      status: "ok",
      lastAttempt: finishedAt.toISOString(),
      lastAttemptDate: date,
      lastSuccess: finishedAt.toISOString(),
      file: name,
      bytes,
      seconds: Math.round((finishedAt - startedAt) / 100) / 10,
      error: null,
      keep: settings.keep,
      time: settings.time,
      timeZone: settings.timeZone,
    });
    const removed = pruned.length
      ? `, removed ${pruned.length} older (keeping ${settings.keep})`
      : "";
    log(`Backup OK: ${name}, ${formatBytes(bytes)}${removed}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeStatus({
      ...previous,
      status: "failed",
      lastAttempt: new Date().toISOString(),
      lastAttemptDate: date,
      error: message,
      keep: settings.keep,
      time: settings.time,
      timeZone: settings.timeZone,
    }).catch(() => {});
    log(`Backup FAILED: ${message}`);
    return false;
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function cleanPartials() {
  for (const name of await fs.readdir(DIR)) {
    if (name.endsWith(".partial")) await fs.rm(path.join(DIR, name), { force: true });
  }
}

async function schedule(settings) {
  log(
    `Backups run daily at ${settings.time} (${settings.timeZone}) into ./backups, keeping the newest ${settings.keep}.`,
  );
  await cleanPartials();
  let running = false;
  const tick = async () => {
    if (running) return;
    const { lastAttemptDate } = await readStatus();
    if (!isDue(localClock(new Date(), settings.timeZone), settings.time, lastAttemptDate)) return;
    running = true;
    try {
      await backup(settings);
    } finally {
      running = false;
    }
  };
  const stop = () => {
    if (running) log("Stopping during a backup; it will run again on the next start.");
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await tick();
  setInterval(() => void tick().catch((e) => log(`Backup check failed: ${e.message}`)), 30_000);
}

async function list() {
  const names = (await fs.readdir(DIR)).filter((n) => /\.(sql\.gz|sql|dump)$/.test(n)).sort();
  if (!names.length) {
    console.log("No backups yet.");
    return;
  }
  for (const name of names) {
    const { size, mtime } = await fs.stat(path.join(DIR, name));
    console.log(`backups/${name}  ${formatBytes(size)}  ${mtime.toISOString().slice(0, 16)}`);
  }
}

async function restore(arg) {
  const file = backupPath(DIR, arg);
  if (!file) {
    throw new Error(
      "Say which backup to restore, for example:\n  docker compose run --rm backup restore backups/bucketbook-2026-11-20.sql.gz\nSee the list with:  docker compose run --rm backup list",
    );
  }
  try {
    await fs.access(file);
  } catch {
    throw new Error(`There is no ${path.basename(file)} in the backups folder.`);
  }
  const db = process.env.PGDATABASE;
  const user = process.env.PGUSER;

  const others = Number(
    await psql(
      `select count(*) from pg_stat_activity where datname = ${quoteLiteral(db)} and pid <> pg_backend_pid()`,
      "postgres",
    ),
  );
  if (others > 0) {
    throw new Error(
      "The app is still connected to the database. Stop it first, then run the restore again:\n  docker compose stop app",
    );
  }

  // Load into a new, empty database first. The current one is only replaced once the
  // whole file loaded, so a bad or truncated backup leaves it untouched.
  const fresh = `${db}_restore`;
  log(`Loading backups/${path.basename(file)} into a fresh database...`);
  await psql(`drop database if exists ${quoteIdent(fresh)}`, "postgres");
  await psql(`create database ${quoteIdent(fresh)} owner ${quoteIdent(user)}`, "postgres");
  try {
    if (file.endsWith(".dump")) {
      await run("pg_restore", ["--no-owner", "--exit-on-error", "-d", fresh, file], {
        quiet: true,
      });
    } else {
      const input = file.endsWith(".gz")
        ? createReadStream(file).pipe(zlib.createGunzip())
        : createReadStream(file);
      await run("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", fresh], { input, quiet: true });
    }
  } catch (err) {
    await psql(`drop database if exists ${quoteIdent(fresh)}`, "postgres").catch(() => {});
    throw new Error(
      `The backup did not load, so nothing was changed: ${err instanceof Error ? err.message : err}`,
    );
  }

  const exists =
    (await psql(`select 1 from pg_database where datname = ${quoteLiteral(db)}`, "postgres")) ===
    "1";
  if (exists) {
    const tables = Number(
      await psql(
        "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')",
      ),
    );
    if (tables > 0) {
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const safety = `before-restore-${stamp}.sql.gz`;
      log(`Saving the database it replaces as backups/${safety}`);
      await dumpTo(safety);
    }
    await psql(`drop database ${quoteIdent(db)} with (force)`, "postgres");
  }
  await psql(`alter database ${quoteIdent(fresh)} rename to ${quoteIdent(db)}`, "postgres");
  log(`Restored backups/${path.basename(file)}. Start the app again with:  docker compose up -d`);
}

async function main() {
  const [command = "schedule", arg] = process.argv.slice(2);
  try {
    if (command === "restore") return await restore(arg);
    if (command === "list") return await list();
    const settings = readSettings(process.env);
    if (command === "now") {
      process.exitCode = (await backup(settings)) ? 0 : 1;
      return;
    }
    if (command === "schedule") return await schedule(settings);
    throw new Error(`Unknown command "${command}". Use schedule, now, list or restore FILE.`);
  } catch (err) {
    console.error(`bucketbook-backup: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
