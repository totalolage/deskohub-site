import type {
  AlgoPin,
  IgloohomeDeviceId,
  IgloohomePinId,
} from "@deskohub/igloohome";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type {
  ReservationAccessGrantId,
  ReservationAccessGrantState,
} from "@/features/reservation-access/reservation-access";
import { reservationAccessGrantStates } from "@/features/reservation-access/reservation-access";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { quotedSqlList } from "./sql-list";
import { workspaceReservations } from "./workspace-reservations";

export const reservationAccessGrants = pgTable(
  "reservation_access_grants",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<ReservationAccessGrantId>(),
    workspaceReservationId: text("workspace_reservation_id")
      .notNull()
      .$type<WorkspaceReservationId>()
      .references(() => workspaceReservations.id),
    provider: text("provider").notNull().default("igloohome"),
    credentialType: text("credential_type").notNull().default("algopin_hourly"),
    deviceId: text("device_id").notNull().$type<IgloohomeDeviceId>(),
    state: text("state").notNull().$type<ReservationAccessGrantState>(),
    providerCredentialId: text(
      "provider_credential_id"
    ).$type<IgloohomePinId>(),
    accessCode: text("access_code").$type<AlgoPin>(),
    scheduledAccessStartsAt: instant("reservation_starts_at").notNull(),
    accessStartsAt: instant("access_starts_at").notNull(),
    accessEndsAt: instant("access_ends_at").notNull(),
    provisioningStartedAt: instant("provisioning_started_at"),
    issuedAt: instant("issued_at"),
    failedAt: instant("failed_at"),
    failureCode: text("failure_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("reservation_access_grants_reservation_unique_idx").on(
      t.workspaceReservationId
    ),
    index("reservation_access_grants_state_idx").on(t.state, t.updatedAt),
    check(
      "reservation_access_grants_provider_check",
      sql`${t.provider} = 'igloohome' and ${t.credentialType} = 'algopin_hourly'`
    ),
    check(
      "reservation_access_grants_state_check",
      sql`${t.state} in (${quotedSqlList(reservationAccessGrantStates)})`
    ),
    check(
      "reservation_access_grants_interval_check",
      sql`${t.accessEndsAt} > ${t.accessStartsAt}`
    ),
    check(
      "reservation_access_grants_issued_check",
      sql`${t.state} <> 'issued' or (
        ${t.providerCredentialId} is not null
        and ${t.accessCode} is not null
        and ${t.issuedAt} is not null
      )`
    ),
    check(
      "reservation_access_grants_provisioning_check",
      sql`${t.state} <> 'provisioning' or ${t.provisioningStartedAt} is not null`
    ),
    check(
      "reservation_access_grants_expired_check",
      sql`${t.state} <> 'expired' or ${t.accessCode} is null`
    ),
    check(
      "reservation_access_grants_failure_check",
      sql`${t.state} <> 'failed' or (${t.failedAt} is not null and ${t.failureCode} is not null)`
    ),
    check(
      "reservation_access_grants_uncertain_check",
      sql`${t.state} <> 'uncertain' or ${t.failureCode} is not null`
    ),
  ]
);

export type ReservationAccessGrantRow =
  typeof reservationAccessGrants.$inferSelect;
