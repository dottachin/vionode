#!/bin/sh
# Optional: restore a database dump on first container start.
# Drop a file named db.dump (custom-format or plain SQL) in this folder to use it.
set -e

DB_NAME="${POSTGRES_DB:-rodb}"
DUMP="/docker-entrypoint-initdb.d/db.dump"

if [ ! -f "$DUMP" ]; then
  echo "No db.dump found; starting with an empty database (migrations will create the schema)."
  exit 0
fi

psql -U "$POSTGRES_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  createdb -U "$POSTGRES_USER" "${DB_NAME}"

if pg_restore -l "$DUMP" >/dev/null 2>&1; then
  echo "Detected custom-format dump; restoring with pg_restore..."
  pg_restore -U "$POSTGRES_USER" -d "$DB_NAME" "$DUMP"
else
  echo "Detected plain SQL dump; restoring with psql..."
  psql -U "$POSTGRES_USER" -d "$DB_NAME" -f "$DUMP"
fi
echo "Restore finished."
