# Backup and restore

Everything Bucketbook keeps is in its folder (the `bucketbook` folder the installer
made, with `docker-compose.yml` in it):

```
bucketbook/
  .env              settings and secrets
  docker-compose.yml
  data/
    postgres/       the database's own files
    receipts/       uploaded receipts
  backups/
    bucketbook-2026-11-20.sql.gz   a copy of the database, made every night
    .last-backup.json              how the last nightly backup went
```

So **back up the whole folder** with whatever you already use (Backrest, restic, Borg,
Duplicati, a NAS snapshot, rsync to another disk). That covers the database, the
receipts and the settings together.

Keep `.env` with your backups. `APP_ENCRYPTION_KEY` protects your stored bank
connection; if it is lost, the data is still fine but you will need to reconnect
SimpleFIN. If `BETTER_AUTH_SECRET` changes, everyone is simply signed out.

The commands below run in the `bucketbook` folder.

## The nightly backup

The `backup` service makes a database copy every night, so your backup tool always has a
complete, consistent one to pick up:

- It runs `pg_dump` at `BACKUP_TIME` (default `02:00`, in the `TZ` from `.env`) and
  writes `backups/bucketbook-YYYY-MM-DD.sql.gz`, a gzipped plain SQL file.
- It keeps the newest `BACKUP_KEEP_DAYS` daily files (default 14) and deletes older
  ones. It never touches other files in `backups/`, so copies you make yourself stay.
- It writes to a hidden `.partial` file, checks that the dump is complete, and only
  then renames it, so a backup tool never picks up a half-written file. You can tell
  your backup tool to skip `*.partial`.
- If the machine was off at `BACKUP_TIME`, it catches up when it next starts that day.

To change the time or how many to keep, edit `.env` and run `docker compose up -d`:

```
BACKUP_TIME=03:30
BACKUP_KEEP_DAYS=30
```

Schedule your folder backup for after `BACKUP_TIME` (a few minutes is plenty for a
household database), so it picks up the same night's copy.

### Checking it

```bash
curl -s http://localhost:9951/api/health
```

The `backup` part shows `status` (`ok`, `failed`, `stale` when the last success is
more than two days old, or `none` before the first run), `lastSuccess`, `file` and,
after a failure, `error`. Each run is also logged:

```bash
docker compose logs backup
```

### Backing up now

Before an update, or whenever you like:

```bash
docker compose exec backup bucketbook-backup now
```

It replaces today's file if there already is one. To see what's there:

```bash
docker compose exec backup bucketbook-backup list
```

### Why not just copy data/postgres?

`data/postgres` holds the database's working files. Copying them while the database runs
can catch them halfway through a write, and that copy may not start. The nightly
`.sql.gz` file is always a complete, consistent snapshot, so restore from that. Backing
up `data/postgres` as well does no harm, but you can exclude it to save space.

The files in `data/postgres` belong to the database's user inside the container
(uid 70), and only that user can read them. If your backup tool runs as your own user
rather than root, it will report those files as unreadable; exclude `data/postgres` and
rely on `backups/`. Everything in `backups/` belongs to the owner of the `backups`
folder (you, if the installer made it) and only they can read it, since each file holds
your whole set of books. Receipts belong to the app's user (uid 1001) and keep the
`data/receipts` folder's group (yours, if the installer made it), which can read them.

## Restore

Restoring replaces the whole database with the one in the backup file you choose.

1. Stop the app so nothing writes during the restore:

   ```bash
   docker compose stop app
   ```

2. Restore, naming a file from `backups/`:

   ```bash
   docker compose run --rm backup restore backups/bucketbook-2026-11-20.sql.gz
   ```

   It loads the file into a new, empty database first, and only swaps it in once the
   whole file has loaded, so a damaged backup leaves your current data alone. The
   database it replaces is saved first as `backups/before-restore-<date and time>.sql.gz`,
   in case you picked the wrong file.

   It also restores `.dump` files (the `pg_dump --format=custom` copies that the 1.0.0 and 1.0.1
   instructions made) and plain `.sql` files.

3. Start the app again:

   ```bash
   docker compose up -d
   ```

   On start the app applies any migrations the backup is missing, so restoring an older
   backup into a newer version of the app works.

Receipts aren't in the database. To get them back, restore `data/receipts` from your
folder backup.

## Moving to a new server

Copy the whole `bucketbook` folder to the new server, with Bucketbook stopped on the old
one (`docker compose down`), then run `docker compose up -d` there. Copy it as root (or
with `sudo`) so the database files keep their owners, for example:

```bash
sudo rsync -a old-server:/path/to/bucketbook/ /path/to/bucketbook/
```

Or copy only `.env`, `docker-compose.yml` and `backups/` (and `data/receipts`), start
it with `docker compose up -d`, then follow the restore steps above.

## Upgrading from 1.0.1 or earlier

Bucketbook 1.0.0 and 1.0.1 kept the database and receipts in Docker volumes (`bucketbook_pgdata`
and `bucketbook_receipts`), outside the folder, so folder backups missed them. The new
`docker-compose.yml` won't start until the data is moved; it stops with a message
pointing here.

Run this once in your `bucketbook` folder:

```bash
curl -fsSL https://raw.githubusercontent.com/cbik6/bucketbook/main/scripts/move-data.sh | sh
```

[The script](../scripts/move-data.sh):

1. Saves a backup of the database as `backups/before-move-<date>.sql.gz` and counts the
   rows in every table.
2. Downloads the new `docker-compose.yml` (keeping yours as `docker-compose.yml.old`)
   and the new images.
3. Stops Bucketbook and copies both volumes into `data/postgres` and `data/receipts`.
4. Checks the copy file by file: same contents, owners and permissions.
5. Adds `DATA_DIR=./data` to `.env`, starts the database on the new folder and checks
   that every table has the same number of rows as before.
6. Starts Bucketbook.
7. Asks whether to remove the old volumes. They are only removed if you type `yes`;
   otherwise it prints the command to remove them later.

The old volumes are never changed. If a step fails, the script stops and prints the
commands that put everything back as it was.

If you changed the compose project name, put `COMPOSE_PROJECT_NAME=<name>` in front of
`sh`.

## Starting over

This deletes all data permanently. Stop Bucketbook, then remove the data folder (its
files belong to the containers' users, hence `sudo`):

```bash
docker compose down
sudo rm -rf data
```
