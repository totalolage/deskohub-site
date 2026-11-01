CREATE TABLE "email_discount_issuances" (
	"preparation_id" text,
	"value_name" text,
	"recovery_identity" text NOT NULL,
	"parameters" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"code" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_discount_issuances_pkey" PRIMARY KEY("preparation_id","value_name"),
	CONSTRAINT "email_discount_issuances_state_check" CHECK ("state" in ('reserved', 'issuing', 'issued', 'issuance-uncertain', 'cleanup-required', 'disabled')),
	CONSTRAINT "email_discount_issuances_parameters_check" CHECK (jsonb_typeof("parameters"::jsonb) = 'object'),
	CONSTRAINT "email_discount_issuances_result_check" CHECK (("code" is null) = ("expires_at" is null) and ("state" <> 'issued' or "code" is not null))
);
--> statement-breakpoint
CREATE TABLE "email_preparations" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"send_id" text NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	"email_version_id" text NOT NULL,
	"locale" text NOT NULL,
	"required_value_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"state" text DEFAULT 'selected' NOT NULL,
	"delivery_outcome" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_preparations_state_check" CHECK ("state" in ('selected', 'preparing', 'ready', 'skipped', 'failed')),
	CONSTRAINT "email_preparations_delivery_check" CHECK ("delivery_outcome" in ('pending', 'delivering', 'accepted', 'definitively-unsent', 'uncertain'))
);
--> statement-breakpoint
CREATE TABLE "email_value_snapshots" (
	"preparation_id" text,
	"value_name" text,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_value_snapshots_pkey" PRIMARY KEY("preparation_id","value_name"),
	CONSTRAINT "email_value_snapshots_json_check" CHECK (jsonb_typeof("value"::jsonb) is not null)
);
--> statement-breakpoint
CREATE TABLE "email_versions" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"email_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"required_value_names" text[] NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_versions_number_check" CHECK ("version_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"title" text NOT NULL,
	"draft" jsonb DEFAULT '{}' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emails_title_check" CHECK (btrim("title") <> '')
);
--> statement-breakpoint
ALTER TABLE "email_campaign_automation_versions" ADD COLUMN "email_id" text;--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD COLUMN "frozen_email_version_id" text;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "email_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "email_discount_issuances_recovery_unique_idx" ON "email_discount_issuances" ("recovery_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "email_preparations_recipient_unique_idx" ON "email_preparations" ("send_id","dotypos_customer_id");--> statement-breakpoint
CREATE INDEX "email_preparations_version_idx" ON "email_preparations" ("email_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_versions_number_unique_idx" ON "email_versions" ("email_id","version_number");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_versions" ADD CONSTRAINT "email_campaign_automation_versions_email_id_emails_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_HvGjdJwNoVwP_fkey" FOREIGN KEY ("frozen_email_version_id") REFERENCES "email_versions"("id");--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_email_id_emails_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id");--> statement-breakpoint
ALTER TABLE "email_discount_issuances" ADD CONSTRAINT "email_discount_issuances_uYJbj9DjsSzz_fkey" FOREIGN KEY ("preparation_id") REFERENCES "email_preparations"("id");--> statement-breakpoint
ALTER TABLE "email_preparations" ADD CONSTRAINT "email_preparations_email_version_id_email_versions_id_fkey" FOREIGN KEY ("email_version_id") REFERENCES "email_versions"("id");--> statement-breakpoint
ALTER TABLE "email_preparations" ADD CONSTRAINT "email_preparations_recipient_fk" FOREIGN KEY ("send_id","dotypos_customer_id") REFERENCES "email_campaign_recipients"("send_id","dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "email_value_snapshots" ADD CONSTRAINT "email_value_snapshots_preparation_id_email_preparations_id_fkey" FOREIGN KEY ("preparation_id") REFERENCES "email_preparations"("id");--> statement-breakpoint
ALTER TABLE "email_versions" ADD CONSTRAINT "email_versions_email_id_emails_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_frozen_email_check" CHECK ("frozen_email_version_id" is null or "automation_version_id" is null);
--> statement-breakpoint
CREATE FUNCTION email_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'email history is immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_versions_immutable BEFORE UPDATE OR DELETE ON email_versions FOR EACH ROW EXECUTE FUNCTION email_history_immutable();
--> statement-breakpoint
CREATE TRIGGER email_value_snapshots_immutable BEFORE UPDATE OR DELETE ON email_value_snapshots FOR EACH ROW EXECUTE FUNCTION email_history_immutable();
--> statement-breakpoint
CREATE TRIGGER email_preparations_retained BEFORE DELETE ON email_preparations FOR EACH ROW EXECUTE FUNCTION email_history_immutable();
--> statement-breakpoint
CREATE TRIGGER email_discount_issuances_retained BEFORE DELETE ON email_discount_issuances FOR EACH ROW EXECUTE FUNCTION email_history_immutable();
--> statement-breakpoint
CREATE FUNCTION email_send_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_email_version_id IS NOT NULL AND
     ROW(NEW.frozen_email_version_id, NEW.automation_version_id) IS DISTINCT FROM ROW(OLD.frozen_email_version_id, OLD.automation_version_id) THEN
    RAISE EXCEPTION 'one-off email version is frozen' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_campaign_sends_version_frozen BEFORE UPDATE ON email_campaign_sends FOR EACH ROW EXECUTE FUNCTION email_send_version_guard();
--> statement-breakpoint
CREATE FUNCTION email_preparation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  selected_send email_campaign_sends%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO STRICT selected_send FROM email_campaign_sends WHERE id = NEW.send_id FOR SHARE;
    IF selected_send.automation_version_id IS NULL AND selected_send.frozen_email_version_id IS DISTINCT FROM NEW.email_version_id THEN
      RAISE EXCEPTION 'one-off preparation must use the send frozen version' USING ERRCODE = '23514';
    END IF;
    SELECT required_value_names INTO STRICT NEW.required_value_names FROM email_versions WHERE id = NEW.email_version_id;
    IF NEW.state <> 'selected' OR NEW.delivery_outcome <> 'pending' THEN
      RAISE EXCEPTION 'preparation must begin selected and pending' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW.send_id, NEW.dotypos_customer_id, NEW.email_version_id, NEW.locale, NEW.required_value_names, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.send_id, OLD.dotypos_customer_id, OLD.email_version_id, OLD.locale, OLD.required_value_names, OLD.created_at) THEN
      RAISE EXCEPTION 'email selection is frozen' USING ERRCODE = '23514';
    END IF;
    IF OLD.state IN ('ready', 'skipped', 'failed') AND NEW.state <> OLD.state THEN
      RAISE EXCEPTION 'sealed preparation cannot reopen' USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'preparing' AND NEW.state = 'selected' THEN
      RAISE EXCEPTION 'preparation cannot move backwards' USING ERRCODE = '23514';
    END IF;
    IF NEW.delivery_outcome <> OLD.delivery_outcome AND NOT (
      (OLD.delivery_outcome = 'pending' AND NEW.delivery_outcome IN ('delivering', 'definitively-unsent')) OR
      (OLD.delivery_outcome = 'delivering' AND NEW.delivery_outcome IN ('accepted', 'uncertain', 'definitively-unsent')) OR
      (OLD.delivery_outcome = 'uncertain' AND NEW.delivery_outcome IN ('accepted', 'definitively-unsent'))
    ) THEN
      RAISE EXCEPTION 'invalid email delivery transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.delivery_outcome IN ('delivering', 'accepted', 'uncertain') AND NEW.state <> 'ready' THEN
    RAISE EXCEPTION 'delivery requires a ready preparation' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'ready' AND EXISTS (
    SELECT 1 FROM unnest(NEW.required_value_names) AS required(name)
    WHERE NOT EXISTS (SELECT 1 FROM email_value_snapshots s WHERE s.preparation_id = NEW.id AND s.value_name = required.name)
  ) THEN
    RAISE EXCEPTION 'email values are incomplete' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_preparations_guard BEFORE INSERT OR UPDATE ON email_preparations FOR EACH ROW EXECUTE FUNCTION email_preparation_guard();
--> statement-breakpoint
CREATE FUNCTION email_snapshot_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE preparation email_preparations%ROWTYPE;
BEGIN
  -- Shares the sealing row lock, so insert and ready cannot race.
  SELECT * INTO STRICT preparation FROM email_preparations WHERE id = NEW.preparation_id FOR UPDATE;
  IF preparation.state NOT IN ('selected', 'preparing') OR NOT (NEW.value_name = ANY(preparation.required_value_names)) THEN
    RAISE EXCEPTION 'email snapshot is sealed or not required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_value_snapshots_insert_guard BEFORE INSERT ON email_value_snapshots FOR EACH ROW EXECUTE FUNCTION email_snapshot_insert_guard();
--> statement-breakpoint
CREATE FUNCTION email_issuance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE preparation email_preparations%ROWTYPE;
BEGIN
  SELECT * INTO STRICT preparation FROM email_preparations WHERE id = NEW.preparation_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'reserved' OR NEW.code IS NOT NULL OR NEW.expires_at IS NOT NULL OR
       preparation.state NOT IN ('selected', 'preparing') OR preparation.delivery_outcome <> 'pending' OR
       NOT (NEW.value_name = ANY(preparation.required_value_names)) THEN
      RAISE EXCEPTION 'invalid email issuance reservation' USING ERRCODE = '23514';
    END IF;
    IF NEW.recovery_identity <> 'email:' || NEW.preparation_id || ':' || NEW.value_name OR
       (NEW.parameters::jsonb->>'expiresAt') IS NULL OR
       (NEW.parameters::jsonb->>'expiresAt')::timestamptz IS NULL THEN
      RAISE EXCEPTION 'issuance requires frozen recovery identity and expiry' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.preparation_id, NEW.value_name, NEW.recovery_identity, NEW.parameters, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.preparation_id, OLD.value_name, OLD.recovery_identity, OLD.parameters, OLD.created_at) THEN
      RAISE EXCEPTION 'email issuance identity and parameters are frozen' USING ERRCODE = '23514';
    END IF;
    IF OLD.code IS NOT NULL AND ROW(NEW.code, NEW.expires_at) IS DISTINCT FROM ROW(OLD.code, OLD.expires_at) THEN
      RAISE EXCEPTION 'issued result is frozen' USING ERRCODE = '23514';
    END IF;
    IF NEW.state <> OLD.state AND NOT (
      (OLD.state = 'reserved' AND NEW.state IN ('issuing', 'disabled')) OR
      (OLD.state = 'issuing' AND NEW.state IN ('issued', 'issuance-uncertain')) OR
      (OLD.state = 'issuance-uncertain' AND NEW.state = 'issued') OR
      (OLD.state = 'issued' AND NEW.state = 'cleanup-required') OR
      (OLD.state = 'cleanup-required' AND NEW.state = 'disabled')
    ) THEN
      RAISE EXCEPTION 'invalid email issuance transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.state = 'issuing' AND (preparation.delivery_outcome <> 'pending' OR preparation.state NOT IN ('selected', 'preparing')) THEN
    RAISE EXCEPTION 'issuance requires pending delivery' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.code IS NULL AND NEW.code IS NOT NULL AND NEW.state <> 'issued' THEN
    RAISE EXCEPTION 'issuance result requires issued state' USING ERRCODE = '23514';
  END IF;
  IF NEW.code IS NOT NULL AND NEW.expires_at IS DISTINCT FROM (NEW.parameters::jsonb->>'expiresAt')::timestamptz THEN
    RAISE EXCEPTION 'issued expiry differs from reservation' USING ERRCODE = '23514';
  END IF;
  IF NEW.state IN ('cleanup-required', 'disabled') AND preparation.delivery_outcome <> 'definitively-unsent' THEN
    RAISE EXCEPTION 'cleanup requires definitively unsent delivery' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_discount_issuances_guard BEFORE INSERT OR UPDATE ON email_discount_issuances FOR EACH ROW EXECUTE FUNCTION email_issuance_guard();
