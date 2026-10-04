import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { AccountVisualRoute } from "./account-route";
import type { AccountVisualAdapterProps } from "./types";

// Synthetic generated portrait placeholder (no PII): a flat illustration
// rendered to PNG at build-authoring time and inlined as a data URL so the
// populated capture shows the avatar state without any network fetch.
const syntheticAvatarUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAADPElEQVR4nO2Z208TQRTG538E9UExIQr4XEABo0JFJUZRY0wQKMYXUVPqi6KAJooRNQYX2kXAXkhZKFCu27UXeuGYM/HBaKKlzvTMUL/kJJvNXr757cyZM7PMcFVBJQejNkAdjNoAdTBqA9TBqA1QB6M2QB2M2gB1MGoD1MGoDVAHozZAHYzaAHUwagPUwagNUAejNlBRAEx3A1i+frBnDUivLUE+k+aBx3jOGuoD011/8ACY7XWwPjEKe4U8/E17hQJsT72DmYunDgaAyEAX5DMp2K/y6RSEPVf0BmA98fAvWqrwXsvn0RNAZKDrnxr/MwSZPYHJeKjZUVdSt//TcAi0n9QHwMbHVyBaG+/H9ABguhuKyvb7FT4Te5byACyfB2QJ6wTlAdizn6UBsL9Mqg8gsx6TBgArRuUB5AVm/1+Fz65sAOmk+gDSa8vSAKRXNRgCdqUnQWuoTxqARe9d9QGY7no5hVBek0LIwFL4w0vhANYnRoT7NKQthtrr+AJGZPYPXDihDwDDVQWh3k4hQ4Evh/svS/FoSN8Q8YnYEOmX5s8ox5YYbmaUMhyw28v88mUDYLiqwH+uFuLjT3kmL+arb356LW3MkwAwfgROY1gnYEGDVR2WzRh4jOcWvb1SpjpaAI3VMNfdzBuH06MTmoHdzTjkkg5Pkhh4jOeckMmvwWvnrjfpDWD+Viv/F5C1t0pMgcDvxfl//maLJgAaq2Hh/jVILS+AaCWXIhC5d5W/Q0kA8zfOQNIKC2/4byAWgzDXfVohAE2HYHXMK+QfQLHCd62Mevm7SQH422ogEQwAlRJf/TDdVkMDIHC+FlKxKFAL8w3WGWUFMN16rCzjvVglo0GYbjlaPgBbk+OgmvCXelkARB/eAVUVHbwtF4D/7HHIOTaoqmxiBzAxSwOwMvIYVFfs+aAcAFPNRyDn7IDqyia2uVfhAMJ9l0AXhXrc4gHE3w6DLsK9B+EAvkVmQRc54RnxALKJbdBFuIwWDqCQy4IuQq+VDSCb+T8EDNE9wNEpCYYkJMH4+DPQRfE3EqbBUG8n6KJgT0cFl8L2FhhNh8UDMHAx9OIRqK7Y8IOi22OUthxWtxeUshz+DiCL92V4Q+AvAAAAAElFTkSuQmCC";

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
  avatar: {
    kind: "available",
    avatar: {
      url: syntheticAvatarUrl,
      version: 1,
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
    "synthetic Ada Example business billing with a synthetic avatar image, three current and two past reservations",
} as const;

export function PopulatedAccountAdapter({ locale }: AccountVisualAdapterProps) {
  return (
    <AccountLayoutShell accountsEnabled locale={locale} signedIn>
      <AccountVisualRoute locale={locale} state={populatedFixture} />
    </AccountLayoutShell>
  );
}

export default PopulatedAccountAdapter;
