-- Initial schema for ACME Salary Management
-- Enforces controlled reference codes, positive BIGINT minor units,
-- append-only salary ledger invariants, and restricted app-role grants.

CREATE TABLE "hr_accounts" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_sessions" (
    "id" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "employee_number" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "department_code" TEXT NOT NULL,
    "level_code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "salary_currency" TEXT NOT NULL,
    "current_salary_minor" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employees_display_name_nonempty" CHECK (char_length(trim("display_name")) > 0),
    CONSTRAINT "employees_country_code_valid" CHECK ("country_code" IN ('US', 'IN', 'GB', 'DE')),
    CONSTRAINT "employees_department_code_valid" CHECK ("department_code" IN ('ENG', 'PROD', 'DESIGN', 'SALES', 'OPS', 'FIN', 'HR')),
    CONSTRAINT "employees_level_code_valid" CHECK ("level_code" IN ('L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7')),
    CONSTRAINT "employees_currency_matches_country" CHECK (
        ("country_code" = 'US' AND "salary_currency" = 'USD') OR
        ("country_code" = 'IN' AND "salary_currency" = 'INR') OR
        ("country_code" = 'GB' AND "salary_currency" = 'GBP') OR
        ("country_code" = 'DE' AND "salary_currency" = 'EUR')
    ),
    CONSTRAINT "employees_salary_positive" CHECK ("current_salary_minor" > 0),
    CONSTRAINT "employees_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "salary_revisions" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "previous_salary_minor" BIGINT,
    "new_salary_minor" BIGINT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "actor_account_id" INTEGER NOT NULL,
    "request_key" TEXT,
    "request_fingerprint" TEXT,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "salary_revisions_sequence_positive" CHECK ("sequence" >= 1),
    CONSTRAINT "salary_revisions_new_salary_positive" CHECK ("new_salary_minor" > 0),
    CONSTRAINT "salary_revisions_previous_salary_rule" CHECK (
        ("sequence" = 1 AND "previous_salary_minor" IS NULL) OR
        ("sequence" > 1 AND "previous_salary_minor" IS NOT NULL AND "previous_salary_minor" > 0)
    ),
    CONSTRAINT "salary_revisions_currency_valid" CHECK ("currency_code" IN ('USD', 'INR', 'GBP', 'EUR')),
    CONSTRAINT "salary_revisions_reason_valid" CHECK (
        "reason_code" IN ('HIRE', 'MERIT', 'PROMOTION', 'MARKET_ADJUSTMENT', 'ANNUAL_REVIEW', 'CORRECTION')
    )
);

CREATE TABLE "fx_snapshots" (
    "id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "source_label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fx_rates" (
    "snapshot_id" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "rate_to_usd" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("snapshot_id", "currency_code"),
    CONSTRAINT "fx_rates_currency_valid" CHECK ("currency_code" IN ('USD', 'INR', 'GBP', 'EUR')),
    CONSTRAINT "fx_rates_positive" CHECK ("rate_to_usd" > 0),
    CONSTRAINT "fx_rates_usd_unity" CHECK ("currency_code" <> 'USD' OR "rate_to_usd" = 1)
);

CREATE TABLE "seed_markers" (
    "seed_version" TEXT NOT NULL,
    "employee_count" INTEGER NOT NULL,
    "reference_date" DATE NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seed_markers_pkey" PRIMARY KEY ("seed_version")
);

-- Essential unique constraints and history ordering index (measure before adding secondary indexes).
CREATE UNIQUE INDEX "hr_accounts_email_key" ON "hr_accounts"("email");
CREATE UNIQUE INDEX "employees_employee_number_key" ON "employees"("employee_number");
CREATE UNIQUE INDEX "salary_revisions_employee_id_sequence_key" ON "salary_revisions"("employee_id", "sequence");
CREATE UNIQUE INDEX "salary_revisions_employee_id_actor_account_id_request_key_key"
    ON "salary_revisions"("employee_id", "actor_account_id", "request_key");

-- Foreign keys
ALTER TABLE "hr_sessions"
    ADD CONSTRAINT "hr_sessions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "hr_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "salary_revisions"
    ADD CONSTRAINT "salary_revisions_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "salary_revisions"
    ADD CONSTRAINT "salary_revisions_actor_account_id_fkey"
    FOREIGN KEY ("actor_account_id") REFERENCES "hr_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_rates"
    ADD CONSTRAINT "fx_rates_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "fx_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure runtime application role (acme_app) exists before granting privileges.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'acme_app') THEN
        CREATE ROLE acme_app LOGIN PASSWORD 'local_app_dev_pass';
    END IF;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO acme_app', current_database());
    GRANT USAGE ON SCHEMA public TO acme_app;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM acme_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE "employees", "hr_sessions" TO acme_app;
    GRANT SELECT, INSERT ON TABLE "salary_revisions" TO acme_app;
    GRANT SELECT ON TABLE "hr_accounts", "fx_snapshots", "fx_rates", "seed_markers" TO acme_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO acme_app;
END
$$;
