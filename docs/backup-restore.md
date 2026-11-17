# Backup and restore

Everything Bucketbook knows lives in three places:

| What                                                 | Where                                        | How to back it up      |
| ---------------------------------------------------- | -------------------------------------------- | ---------------------- |
| The database (books, accounts, transactions, logins) | Docker volume `bucketbook_pgdata`            | `pg_dump` (below)      |
| Uploaded receipts                                    | Docker volume `bucketbook_receipts`          | Copy the files (below) |
| Your settings and secrets                            | The `.env` file next to `docker-compose.yml` | Copy it somewhere safe |

Keep `.env` with your backups. `APP_ENCRYPTION_KEY` protects your stored bank
connection; if it is lost, the data is still fine but you will need to reconnect
SimpleFIN. If `BETTER_AUTH_SECRET` changes, everyone is simply signed out.

The commands below assume you are in the folder with `docker-compose.yml` and that you
kept the default database user and name (`bucketbook`). Volume names start with the
compose project name, which is `bucketbook` unless you changed it.

## Back up

### Database

A `pg_dump` is a consistent snapshot even while the app is running.

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U bucketbook -d bucketbook --format=custom \
  > "backups/bucketbook-$(date +%Y-%m-%d).dump"
```

The custom format is compressed and lets you restore single tables if you ever need to.
For a plain SQL file you can read, use `--format=plain` and name it `.sql` instead.

### Receipts

```bash
docker run --rm -v bucketbook_receipts:/data:ro -v "$PWD/backups:/backup" alpine \
  tar czf "/backup/receipts-$(date +%Y-%m-%d).tar.gz" -C /data .
```

### Automating it

A nightly cron entry on the Docker host, for example:

```
15 2 * * * cd /path/to/bucketbook && docker compose exec -T postgres pg_dump -U bucketbook -d bucketbook --format=custom > backups/bucketbook-$(date +\%Y-\%m-\%d).dump
```

Copy the `backups` folder off the machine (another disk, a NAS, or cloud storage) and
delete old files now and then. Test a restore once in a while; an untested backup is a
hope, not a backup.

## Restore

Restoring replaces what is in the database now. Back up the current state first if
there is anything in it you might want.

1. Stop the app so nothing writes during the restore (Postgres keeps running):

   ```bash
   docker compose stop app
   ```

2. Restore the database. `--clean --if-exists` drops existing tables before recreating
   them:

   ```bash
   docker compose exec -T postgres pg_restore -U bucketbook -d bucketbook \
     --clean --if-exists --no-owner < backups/bucketbook-2026-11-17.dump
   ```

   For a plain `.sql` backup instead:

   ```bash
   docker compose exec -T postgres psql -U bucketbook -d bucketbook < backups/bucketbook-2026-11-17.sql
   ```

3. Restore receipts:

   ```bash
   docker run --rm -v bucketbook_receipts:/data -v "$PWD/backups:/backup" alpine \
     sh -c "rm -rf /data/* && tar xzf /backup/receipts-2026-11-17.tar.gz -C /data"
   ```

4. Put back the `.env` from the same backup if this is a new machine, then start the app:

   ```bash
   docker compose up -d
   ```

   On start the app applies any migrations the backup is missing, so restoring an older
   backup into a newer version of the app works.

## Moving to a new server

Back up on the old server, copy the `backups` folder and `.env` to the new one, clone the
repository there, then follow the restore steps (start with `docker compose up -d
postgres` so the database exists before step 2).

## Starting over

This deletes all data permanently:

```bash
docker compose down -v
```
