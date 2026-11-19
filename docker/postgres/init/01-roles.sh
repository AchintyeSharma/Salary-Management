#!/bin/sh
set -e

APP_USER="${APP_DB_USER:-acme_app}"
APP_PASS="${APP_DB_PASSWORD:-local_app_dev_pass}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${APP_USER}') THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${APP_USER}', '${APP_PASS}');
    END IF;
  END
  \$\$;

  GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${APP_USER}";
  GRANT USAGE ON SCHEMA public TO "${APP_USER}";
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  SELECT 'CREATE DATABASE acme_test OWNER "${POSTGRES_USER}"'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'acme_test')\gexec
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname acme_test <<-EOSQL
  GRANT CONNECT ON DATABASE acme_test TO "${APP_USER}";
  GRANT USAGE ON SCHEMA public TO "${APP_USER}";
EOSQL
