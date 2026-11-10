import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type {
  CustomerAgentClientId,
  CustomerAgentGrant,
  CustomerAgentScope,
} from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  type AgentSelectionKey,
  deriveAgentCheckoutAttemptId,
  deriveAgentCheckoutIdentifiers,
} from "./booking-agent";
import type { SelectedReservation } from "./booking-selection";

/*
 * Golden vectors for the identifiers of an agent booking request. Live agent
 * holds are found again by these values, so a change to any digest input
 * (its bytes, order, separators, encoding, hash, or truncation) breaks
 * idempotency and supersession for holds already made. The expected values
 * never change; only how the test reaches the derivation may.
 */

const identifiersFor = (
  grant: CustomerAgentGrant,
  reservation: SelectedReservation
) => deriveAgentCheckoutIdentifiers({ grant, reservation });

const attemptAfter = (
  selectionKey: AgentSelectionKey,
  previousReservationId?: WorkspaceReservationId
) => deriveAgentCheckoutAttemptId(selectionKey, previousReservationId);

const grant = ({
  accountId = "account-golden-1",
  clientId = "https://assistant.example/client.json",
  scopes = ["reservations:create"],
}: {
  readonly accountId?: string;
  readonly clientId?: string;
  readonly scopes?: ReadonlyArray<CustomerAgentScope>;
} = {}): CustomerAgentGrant => ({
  accountId: accountId as CustomerAccountId,
  clientId: clientId as CustomerAgentClientId,
  scopes: new Set(scopes),
});

const cowork = {
  kind: "cowork",
  entryTier: "open-space",
  date: "2026-12-01",
  coffee: false,
} as const satisfies SelectedReservation;

const meetingRoom = {
  kind: "meeting-room",
  duration: { unit: "hour", amount: 1 },
  reservationDate: "2026-12-01",
  startsAt: instantStringSchema.make("2026-12-01T13:00:00Z"),
  endsAt: instantStringSchema.make("2026-12-01T14:00:00Z"),
} as const satisfies SelectedReservation;

const baseSession = "agent-session--7NQhPOJGjs7DHTkVAKjg2Yoo5_5U30sJnGXqYtrjLQ";
const baseSelection =
  "agent-selection-TnBgkc109xP5TCvoso5JENfDJu-TS6NwC2nAAYeTq10";
const baseFirstAttempt =
  "agent-attempt-7O2-9OpqDE46w3YN2ASyvcwi0ElCKFBsLBusWbxHzc0";

describe("agent checkout identifiers", () => {
  test.each([
    {
      name: "a cowork selection",
      grant: grant(),
      reservation: cowork,
      expected: {
        checkoutSessionId: baseSession,
        selectionKey: baseSelection,
        checkoutAttemptId: baseFirstAttempt,
      },
    },
    {
      // Scopes are not an input: the session is the account and the client.
      name: "the same selection under a grant with other scopes",
      grant: grant({ scopes: ["reservations:create", "reservations:read"] }),
      reservation: cowork,
      expected: {
        checkoutSessionId: baseSession,
        selectionKey: baseSelection,
        checkoutAttemptId: baseFirstAttempt,
      },
    },
    {
      name: "another account",
      grant: grant({ accountId: "account-golden-2" }),
      reservation: cowork,
      expected: {
        checkoutSessionId:
          "agent-session-qyWMVYw4NKS2D5R0jB1Cy4ccZY8l0yXSz6NHb54xhEk",
        selectionKey:
          "agent-selection-dxOjCd4rjeBats1BUBzJzPRpVBKHL1D8bgaaIunhPJQ",
        checkoutAttemptId:
          "agent-attempt-aJT-HLgrWV5dz-pDd8RV6QuFWtYRu_NJ4w0gkrEhBTE",
      },
    },
    {
      name: "another agent client",
      grant: grant({ clientId: "https://other-assistant.example/client.json" }),
      reservation: cowork,
      expected: {
        checkoutSessionId:
          "agent-session-XX1AluT-PcmmVEHHWpYs8dFYDhr39kH48qeXRRTJDKY",
        selectionKey:
          "agent-selection-Ir5AmdB0LZc8fPo8jRHCieHReNmhe8w-eHV179YKUOA",
        checkoutAttemptId:
          "agent-attempt--1KCtgAFGCZaeATwRaz6OUNIef1V50CkfNMv9rKfalo",
      },
    },
    {
      name: "another date",
      grant: grant(),
      reservation: { ...cowork, date: "2026-12-02" },
      expected: {
        checkoutSessionId: baseSession,
        selectionKey:
          "agent-selection-fbqqVX_VJa5ihuxIMvAIy5gJGVyhU7s0RHErpUuZt2o",
        checkoutAttemptId:
          "agent-attempt-TTnt9Y1J_9CWKZsecwMa00ayVSG3_qIAB0pmo7x_Wss",
      },
    },
    {
      name: "another cowork tier",
      grant: grant(),
      reservation: { ...cowork, entryTier: "reserved-desk" },
      expected: {
        checkoutSessionId: baseSession,
        selectionKey:
          "agent-selection-dvu-yqbuS8XrLwQ10gH2XrWz91cqK4gJa9plEBPhBr8",
        checkoutAttemptId:
          "agent-attempt-GDo5otmymZfORyt4YB0FL75krOdtXu53_zfjnd2Nq-s",
      },
    },
    {
      name: "coffee",
      grant: grant(),
      reservation: { ...cowork, coffee: true },
      expected: {
        checkoutSessionId: baseSession,
        selectionKey:
          "agent-selection-xkPLxaq7-Lp9Y0ZgWzKviN-QDDFVpvjEkuXLtsV4OLE",
        checkoutAttemptId:
          "agent-attempt-UEBASDQfL5UphC8SRHJJqLeQd8jf1CqM2yA-dRiD3rU",
      },
    },
    {
      name: "a monitor option",
      grant: grant(),
      reservation: { ...cowork, monitorOption: "2x27-qhd" },
      expected: {
        checkoutSessionId: baseSession,
        selectionKey:
          "agent-selection-bufAsp_NCYdMJnAlL3Dy4Sxvh-hh55crk8fb3xAoFUg",
        checkoutAttemptId:
          "agent-attempt-UtLiSdNJPk5UoJxseULxiae0_dHz9Fbbn8MMQ9D86aM",
      },
    },
    {
      // The selection is digested as its JSON text, so field order counts.
      name: "the same cowork fields in another order",
      grant: grant(),
      reservation: {
        kind: "cowork",
        date: "2026-12-01",
        entryTier: "open-space",
        coffee: false,
      },
      expected: {
        checkoutSessionId: baseSession,
        selectionKey:
          "agent-selection-H7_3y2WTiIqWNGOgx9r99gR89rrNLodwKH6SYTeRMeM",
        checkoutAttemptId:
          "agent-attempt-kWsFY2J4NPH3ElnZY3UJJUYjls736IehKztmyhTX-ZA",
      },
    },
    {
      name: "a meeting room",
      grant: grant(),
      reservation: meetingRoom,
      expected: {
        checkoutSessionId: baseSession,
        selectionKey:
          "agent-selection-6zy9sQo6Q2F2xeW62OfeujqyeRCdu1pPFnJb0WtxgNo",
        checkoutAttemptId:
          "agent-attempt-MEwh6zlJ47PKMM-q4qsmS8xWCzcqMFbW2Prj7rX1Se8",
      },
    },
    {
      name: "a meeting room with early setup",
      grant: grant(),
      reservation: { ...meetingRoom, earlySetup: true },
      expected: {
        checkoutSessionId: baseSession,
        selectionKey:
          "agent-selection-207TujHqmpiWKkyferI0j-48L5stLa4-DFSHuVofmto",
        checkoutAttemptId:
          "agent-attempt-NCfY4LVZOFaZ9J9RX6xxnoqxz2Q4RookyF23vNpqDd0",
      },
    },
    {
      name: "an office",
      grant: grant(),
      reservation: {
        kind: "office",
        startsOn: "2026-12-01",
        endsOn: "2026-12-05",
        seats: 2,
      },
      expected: {
        checkoutSessionId: baseSession,
        selectionKey:
          "agent-selection-g84SWOFV-iUvBFoU13UT7hPkysPBPwol36DsS5Jbgnk",
        checkoutAttemptId:
          "agent-attempt-BmK9UGkup7B6daYWPluyCE-igvYiPcirHVMlaeEbhf8",
      },
    },
  ] as const)("derives the pinned identifiers for $name", (vector) => {
    expect(identifiersFor(vector.grant, vector.reservation)).toEqual(
      vector.expected as never
    );
  });

  test("derives the request's first attempt without a previous reservation", () => {
    expect(attemptAfter(baseSelection as AgentSelectionKey)).toBe(
      baseFirstAttempt as never
    );
  });

  test.each([
    {
      previous: "01890a5d-ac96-774b-bcce-b302099a8057",
      expected: "agent-attempt-KV7T6fSfMnH_f96qjSapkP1aCM1SvG38GdXa3WVVF9E",
    },
    {
      previous: "01890a5d-ac96-774b-bcce-b302099a8058",
      expected: "agent-attempt-DXVhnNwnr6oiRTTFI0xF1JL1Wcj1SjLD07ULfBAjlOQ",
    },
  ])(
    "derives the pinned attempt after reservation $previous",
    ({ previous, expected }) => {
      expect(
        attemptAfter(
          baseSelection as AgentSelectionKey,
          previous as WorkspaceReservationId
        )
      ).toBe(expected as never);
    }
  );
});
