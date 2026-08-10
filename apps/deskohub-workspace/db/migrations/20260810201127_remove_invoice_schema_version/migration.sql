ALTER TABLE "invoices" DROP CONSTRAINT "invoices_schema_version_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "schema_version";