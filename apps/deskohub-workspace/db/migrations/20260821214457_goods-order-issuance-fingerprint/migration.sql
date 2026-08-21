ALTER TABLE "orders" ADD COLUMN "issuance_fingerprint" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_issuance_fingerprint_check" CHECK (("kind" = 'goods' and "issuance_fingerprint" ~ '^[a-f0-9]{64}$')
        or ("kind" <> 'goods' and "issuance_fingerprint" is null));