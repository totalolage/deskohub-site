ALTER TABLE "discount_codes" ADD COLUMN "service_date_from" date;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "service_date_until" date;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_service_window_check" CHECK ((
        "service_date_from" is null and "service_date_until" is null
      ) or (
        "service_date_from" is not null
        and "service_date_until" is not null
        and "service_date_until" > "service_date_from"
      ));