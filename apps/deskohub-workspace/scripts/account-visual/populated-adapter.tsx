import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { AccountVisualRoute } from "./account-route";
import type { AccountVisualAdapterProps } from "./types";

const populatedFixture = {
  kind: "linked",
  email: "ada@example.test",
  profile: {
    firstName: "Ada",
    lastName: "Example",
    phone: null,
    billing: {
      kind: "business",
      companyName: "Example Workspace s.r.o.",
      companyId: "12345678",
      vatId: "CZ12345678",
      addressLine1: "Example Street 42",
      addressLine2: null,
      city: "Prague",
      zip: "110 00",
      country: "CZ",
    },
  },
  history: {
    kind: "available",
    groups: {
      current: [
        {
          id: "provider-cowork-current",
          workspaceReservationId: workspaceReservationIdSchema.make(
            "account-visual-cowork-current"
          ),
          product: { kind: "cowork", tier: "plus" },
          startsAt: "2026-11-09T23:00:00.000Z",
          endsAt: "2026-11-10T23:00:00.000Z",
          seats: 1,
          status: "confirmed",
        },
        {
          id: "provider-meeting-room-current",
          workspaceReservationId: workspaceReservationIdSchema.make(
            "account-visual-meeting-room-current"
          ),
          product: { kind: "meeting-room" },
          startsAt: "2026-11-10T12:00:00.000Z",
          endsAt: "2026-11-10T14:00:00.000Z",
          seats: 4,
          status: "pending",
        },
        {
          id: "provider-other-current",
          product: { kind: "other" },
          startsAt: "2026-11-10T15:00:00.000Z",
          endsAt: "2026-11-10T16:00:00.000Z",
          seats: null,
          status: "requires-attention",
        },
      ],
      past: [
        {
          id: "provider-office-past",
          workspaceReservationId: workspaceReservationIdSchema.make(
            "account-visual-office-past"
          ),
          product: { kind: "office" },
          startsAt: "2026-10-12T07:00:00.000Z",
          endsAt: "2026-10-12T15:00:00.000Z",
          seats: 2,
          status: "confirmed",
        },
        {
          id: "provider-cowork-past",
          workspaceReservationId: workspaceReservationIdSchema.make(
            "account-visual-cowork-past"
          ),
          product: { kind: "cowork", tier: "basic" },
          startsAt: "2026-09-18T07:00:00.000Z",
          endsAt: "2026-09-18T15:00:00.000Z",
          seats: 1,
          status: "cancelled",
        },
      ],
      unavailable: [],
    },
  },
} as const satisfies CustomerAccountPageState;

export const accountVisualFixture = populatedFixture;

export const accountVisualAdapterMetadata = {
  owner: "account-visual populated adapter",
  fixture:
    "synthetic Ada Example business billing with three current and two past reservations",
} as const;

export function PopulatedAccountAdapter({ locale }: AccountVisualAdapterProps) {
  return <AccountVisualRoute locale={locale} state={populatedFixture} />;
}

export default PopulatedAccountAdapter;
