ALTER TABLE "email_preparations" ADD COLUMN "outcome_reason" text;--> statement-breakpoint
ALTER TABLE "email_preparations" ADD COLUMN "outcome_value_name" text;--> statement-breakpoint
ALTER TABLE "email_preparations" ADD COLUMN "unavailable_reason" text;--> statement-breakpoint
ALTER TABLE "email_preparations" ADD COLUMN "unavailable_value_name" text;--> statement-breakpoint
ALTER TABLE "email_preparations" ADD COLUMN "unavailable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_preparations" ADD CONSTRAINT "email_preparations_outcome_check" CHECK ((case "state" when 'skipped' then "outcome_reason" is not null and "outcome_reason" in ('missing-language', 'missing-customer', 'missing-value') when 'failed' then "outcome_reason" is not null and "outcome_reason" in ('customer-rejected', 'customer-unauthorized', 'discount-unavailable', 'invalid-value') else "outcome_reason" is null end) and ("outcome_value_name" is null or "outcome_reason" is not null));--> statement-breakpoint
ALTER TABLE "email_preparations" ADD CONSTRAINT "email_preparations_unavailable_check" CHECK (("unavailable_reason" is null and "unavailable_value_name" is null and "unavailable_at" is null) or ("unavailable_reason" is not null and "unavailable_reason" in ('customer-unavailable', 'issuance-unavailable') and "unavailable_value_name" is not null and "unavailable_at" is not null));--> statement-breakpoint
CREATE FUNCTION email_preparation_outcome_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.outcome_reason IS NOT NULL AND
     ROW(NEW.outcome_reason, NEW.outcome_value_name) IS DISTINCT FROM ROW(OLD.outcome_reason, OLD.outcome_value_name) THEN
    RAISE EXCEPTION 'email preparation outcome is frozen' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_preparations_outcome_frozen BEFORE UPDATE ON email_preparations FOR EACH ROW EXECUTE FUNCTION email_preparation_outcome_guard();
