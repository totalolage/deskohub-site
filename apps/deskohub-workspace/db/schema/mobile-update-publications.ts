import { jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { instant } from "../instant";

/**
 * Every over-the-air update and rollback published for the mobile app, kept
 * as history; the newest row for a platform and runtime version is the one
 * installed apps receive. Rows describe app releases only, never customers.
 */
export const mobileUpdatePublications = pgTable(
  "mobile_update_publications",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    runtimeVersion: text("runtime_version").notNull(),
    /** The published `MobileUpdatePublication`, decoded on every read. */
    publication: jsonb("publication").notNull(),
    publishedAt: instant("published_at").notNull(),
  },
  (t) => [
    // Strictly ordered per platform and runtime version, newest last.
    uniqueIndex("mobile_update_publications_published_at_key").on(
      t.platform,
      t.runtimeVersion,
      t.publishedAt
    ),
  ]
);
