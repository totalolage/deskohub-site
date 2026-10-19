import { expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { Effect } from "effect";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  isWorkspaceE2EOfficeCaseId,
  workspaceE2ENonPaymentCaseIds,
} from "../playwright-checkout/case-catalog";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { meetingRoomE2EDurations } from "./meeting-room";
import {
  findReservationUrlStateMismatch,
  makeReservationUrlStateE2ECases,
  type ReservationUrlState,
} from "./reservation-url-state";

const baseUrl = "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app";
const officeState: ReservationUrlState = {
  pathname: "/en-US/reservation/office",
  preserved: { utm_source: "workspace-e2e-url-state" },
  selection: {
    dayCount: "2",
    monitorOption: undefined,
    startsOn: "2099-08-06",
  },
};
const officeUrl = (query: string) =>
  `${baseUrl}/en-US/reservation/office?${query}`;

test("accepts a URL carrying the selection and the preserved parameter", () => {
  expect(
    findReservationUrlStateMismatch(
      officeUrl(
        "utm_source=workspace-e2e-url-state&startsOn=2099-08-06&dayCount=2"
      ),
      officeState
    )
  ).toBeUndefined();
});

test("reads a percent-encoded meeting-room start as the parser does", () => {
  expect(
    findReservationUrlStateMismatch(
      `${baseUrl}/en-US/reservation/meeting-room?startDateTime=2099-08-06T10%3A00&duration=hour%3A4`,
      {
        pathname: "/en-US/reservation/meeting-room",
        preserved: {},
        selection: { duration: "hour:4", startDateTime: "2099-08-06T10:00" },
      }
    )
  ).toBeUndefined();
});

test("names a contact parameter in the URL without its value", () => {
  for (const name of ["name", "email", "phone", "customer"]) {
    const mismatch = findReservationUrlStateMismatch(
      officeUrl(
        `utm_source=workspace-e2e-url-state&startsOn=2099-08-06&dayCount=2&${name}=synthetic-value`
      ),
      officeState
    );
    expect(mismatch).toBe(`contact parameter ${name} present`);
    expect(mismatch).not.toContain("synthetic-value");
  }
});

test("rejects a missing, different, or removed selection parameter", () => {
  expect(
    findReservationUrlStateMismatch(
      officeUrl("utm_source=workspace-e2e-url-state&startsOn=2099-08-06"),
      officeState
    )
  ).toBe("selection parameter dayCount missing or different");
  expect(
    findReservationUrlStateMismatch(
      officeUrl(
        "utm_source=workspace-e2e-url-state&startsOn=2099-08-07&dayCount=2"
      ),
      officeState
    )
  ).toBe("selection parameter startsOn missing or different");
  expect(
    findReservationUrlStateMismatch(
      officeUrl(
        "utm_source=workspace-e2e-url-state&startsOn=2099-08-06&dayCount=2&monitorOption=2x32-qhd"
      ),
      officeState
    )
  ).toBe("removed selection parameter monitorOption present");
});

test("rejects a dropped preserved parameter or a changed path", () => {
  expect(
    findReservationUrlStateMismatch(
      officeUrl("startsOn=2099-08-06&dayCount=2"),
      officeState
    )
  ).toBe("preserved parameter utm_source missing or different");
  expect(
    findReservationUrlStateMismatch(
      `${baseUrl}/cs-CZ/reservation/office?utm_source=workspace-e2e-url-state&startsOn=2099-08-06&dayCount=2`,
      officeState
    )
  ).toBe("path changed");
  expect(findReservationUrlStateMismatch("", officeState)).toBe(
    "URL is not readable"
  );
});

const makeCases = (withOffice: boolean) =>
  Effect.runPromise(
    makeReservationUrlStateE2ECases({
      allocation: {
        fromOffsetDays: 14,
        shardCount: 1,
        shardIndex: 0,
        toOffsetDays: 90,
      },
      config: {
        baseUrl,
        bypassSecret: undefined,
        expectedHost: new URL(baseUrl).host,
        timeouts: workspaceE2ETimeouts,
      } satisfies WorkspaceE2EConfig,
      datasourceConfig: {} as DatasourceConfig,
      preparation: {
        discounts: {
          availableBasicDates: ["2099-08-03"],
          availablePlusDates: [],
          availableReservedDeskDates: ["2099-08-04"],
        },
        meetingRoom: {
          slots: meetingRoomE2EDurations.map((duration, index) => {
            const date = `2099-09-${String(index + 1).padStart(2, "0")}`;
            const startDateTime = `${date}T10:00`;
            const interval = getMeetingRoomReservationInterval(
              startDateTime,
              duration
            );
            if (!interval) throw new Error("meeting-room interval is invalid");
            return { date, duration, startDateTime, ...interval };
          }),
        },
        office: withOffice
          ? {
              slot: {
                endsAt: "2099-08-07T22:00:00.000Z",
                endsOn: "2099-08-07",
                seats: 2,
                startsAt: "2099-08-05T22:00:00.000Z",
                startsOn: "2099-08-06",
              },
              urlStateSlot: {
                endsAt: "2099-08-13T22:00:00.000Z",
                endsOn: "2099-08-13",
                seats: 2,
                startsAt: "2099-08-11T22:00:00.000Z",
                startsOn: "2099-08-12",
              },
            }
          : undefined,
      },
      run: (async () => ({ exitCode: 0, stderr: "", stdout: "" })) as Runner,
    })
  );

test("plans every URL-state case as a catalogued non-payment case holding nothing", async () => {
  const cases = await makeCases(true);
  const expectedCaseIds = workspaceE2ENonPaymentCaseIds.filter((caseId) =>
    caseId.startsWith("reservation-url-state-")
  );

  expect(cases.map(({ id }) => id).toSorted()).toEqual(
    [...expectedCaseIds].toSorted()
  );
  expect(cases.every(({ checkoutStates }) => checkoutStates.length === 0)).toBe(
    true
  );
  expect(
    cases.every(
      ({ timeoutMs }) =>
        timeoutMs === workspaceE2ETimeouts.reservationUrlStateCase
    )
  ).toBe(true);
});

test("plans no office case when the office page is disabled", async () => {
  const cases = await makeCases(false);

  expect(cases.map(({ id }) => id).toSorted()).toEqual([
    "reservation-url-state-cowork",
    "reservation-url-state-meeting-room",
  ]);
  expect(
    workspaceE2ENonPaymentCaseIds
      .filter((caseId) => caseId.startsWith("reservation-url-state-office"))
      .every(isWorkspaceE2EOfficeCaseId)
  ).toBe(true);
});
