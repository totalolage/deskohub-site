import { describe, expect, test } from "bun:test";
import type {
  CustomerAvailability,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import {
  type CoworkAvailability,
  type CoworkDraft,
  coworkAvailabilityQueries,
  coworkEnablement,
  defaultCoworkDraft,
  normalizeCoworkWorkstation,
  selectCoworkTier,
  selectCoworkWorkstation,
  toCoworkSelection,
} from "./cowork-selection";

const money = { value: 0, exponent: 2, currency: "CZK" };
const advertisedPrice = { price: money, discount: money };

const coworkOffering = (
  tier: "open-space" | "reserved-desk"
): CustomerOffering => ({
  family: "cowork",
  tier,
  name: tier,
  description: "",
  usage: "",
  price: money,
  advertisedPrice,
  addOns:
    tier === "reserved-desk"
      ? [
          { id: "coffee", name: "Coffee", price: money, included: true },
          {
            id: "workstation",
            name: "Workstation",
            price: money,
            included: false,
            options: [
              { id: "2x27-qhd", name: "2× 27″ QHD" },
              { id: "2x32-qhd", name: "2× 32″ QHD" },
              { id: "2x27-4k", name: "2× 27″ 4K" },
              { id: "2x32-4k", name: "2× 32″ 4K" },
            ],
          },
        ]
      : [{ id: "coffee", name: "Coffee", price: money, included: false }],
});

const offerings = [
  coworkOffering("open-space"),
  coworkOffering("reserved-desk"),
];

const availability = (
  overrides: Partial<CustomerAvailability> = {}
): CustomerAvailability => ({
  from: "2026-11-07",
  to: "2027-05-07",
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
  ...overrides,
});

const settled = (
  overrides: Partial<CustomerAvailability> = {}
): CoworkAvailability => ({
  range: Option.some(availability(overrides)),
  selection: Option.some(availability(overrides)),
  workstationRequirement: Option.some(availability(overrides)),
});

// Saturday 7 November 2026, 10:00 in Prague (CET).
const morning = new Date("2026-11-07T09:00:00Z");
const today = "2026-11-07";

const reservedDesk: CoworkDraft = selectCoworkTier(
  defaultCoworkDraft(today, offerings),
  "reserved-desk"
);

const blockerTags = (
  draft: CoworkDraft,
  now: Date,
  coworkAvailability: CoworkAvailability
) =>
  coworkEnablement(draft, {
    now,
    offerings,
    availability: coworkAvailability,
  }).blockers.map((blocker) => blocker._tag);

describe("defaultCoworkDraft", () => {
  test("opens on Open Space today without coffee or a workstation", () => {
    expect(defaultCoworkDraft(today, offerings)).toEqual({
      tier: "open-space",
      date: today,
      coffee: false,
      workstation: Option.none(),
    });
  });

  test("falls back to the first tier offered without Open Space", () => {
    expect(
      defaultCoworkDraft(today, [coworkOffering("reserved-desk")]).tier
    ).toBe("reserved-desk");
  });
});

describe("toCoworkSelection", () => {
  test("sends coffee for Open Space", () => {
    const draft = { ...defaultCoworkDraft(today, offerings), coffee: true };

    expect(toCoworkSelection(draft)).toEqual({
      family: "cowork",
      date: today,
      tier: "open-space",
      coffee: true,
    });
  });

  test("leaves coffee out for a Reserved Desk, which includes it", () => {
    const draft = { ...reservedDesk, coffee: true };

    expect(toCoworkSelection(draft)).toEqual({
      family: "cowork",
      date: today,
      tier: "reserved-desk",
    });
  });

  test("sends a Reserved Desk's workstation", () => {
    const draft = selectCoworkWorkstation(reservedDesk, Option.some("2x27-4k"));

    expect(toCoworkSelection(draft).monitorOption).toBe("2x27-4k");
  });

  test("drops the workstation when switching to Open Space", () => {
    const draft = selectCoworkTier(
      selectCoworkWorkstation(reservedDesk, Option.some("2x27-4k")),
      "open-space"
    );

    expect(draft.workstation).toEqual(Option.none());
    expect(toCoworkSelection(draft).monitorOption).toBeUndefined();
  });
});

describe("coworkAvailabilityQueries", () => {
  test("asks for the tier's six-month calendar and the selected date", () => {
    const queries = coworkAvailabilityQueries(
      defaultCoworkDraft(today, offerings),
      today
    );

    expect(queries).toEqual({
      range: {
        kind: "cowork",
        from: "2026-11-07",
        to: "2027-05-07",
        entryTier: "open-space",
      },
      selection: {
        kind: "cowork",
        from: today,
        to: today,
        entryTier: "open-space",
        date: today,
      },
      workstationRequirement: Option.none(),
    });
  });

  test("ends the calendar on the last day of a shorter month", () => {
    const draft = { ...defaultCoworkDraft("2026-08-31", offerings) };

    expect(coworkAvailabilityQueries(draft, "2026-08-31").range.to).toBe(
      "2027-02-28"
    );
  });

  test("checks a Reserved Desk's workstation and its requirement apart", () => {
    const draft = selectCoworkWorkstation(reservedDesk, Option.some("2x32-4k"));
    const queries = coworkAvailabilityQueries(draft, today);

    expect(queries.selection.monitorOption).toBe("2x32-4k");
    expect(queries.workstationRequirement).toEqual(
      Option.some({
        kind: "cowork",
        from: today,
        to: today,
        entryTier: "reserved-desk",
        date: today,
      })
    );
  });
});

describe("coworkEnablement", () => {
  test("offers today through six months and disables taken dates", () => {
    const enablement = coworkEnablement(defaultCoworkDraft(today, offerings), {
      now: morning,
      offerings,
      availability: settled({ unavailableDates: ["2026-11-10"] }),
    });

    expect(enablement.dates.earliest).toBe(today);
    expect(enablement.dates.latest).toBe("2027-05-07");
    expect([...enablement.dates.unavailable]).toEqual(["2026-11-10"]);
    expect(enablement.blockers).toEqual([]);
  });

  test("keeps a date selectable for a Reserved Desk that only needs a workstation", () => {
    const enablement = coworkEnablement(reservedDesk, {
      now: morning,
      offerings,
      availability: settled({
        unavailableDates: ["2026-11-10", "2026-11-11"],
        reservedDeskWorkstationRequiredDates: ["2026-11-10"],
      }),
    });

    expect([...enablement.dates.unavailable]).toEqual(["2026-11-11"]);
  });

  test("blocks an offer taken on its date", () => {
    expect(
      blockerTags(
        defaultCoworkDraft(today, offerings),
        morning,
        settled({ unavailableCoworkTiers: ["open-space"] })
      )
    ).toEqual(["OfferUnavailable"]);
  });

  test("waits for every query the tier needs", () => {
    expect(
      blockerTags(reservedDesk, morning, {
        ...settled(),
        workstationRequirement: Option.none(),
      })
    ).toEqual(["AvailabilityPending"]);
    expect(
      blockerTags(defaultCoworkDraft(today, offerings), morning, {
        ...settled(),
        workstationRequirement: Option.none(),
      })
    ).toEqual([]);
  });

  test("blocks a date outside today through six months", () => {
    const draft = {
      ...defaultCoworkDraft(today, offerings),
      date: "2027-05-08",
    };

    expect(blockerTags(draft, morning, settled())).toEqual(["DateOutOfRange"]);
  });

  describe("same-day Open Space", () => {
    const openSpace = defaultCoworkDraft(today, offerings);

    test("closes at 17:00 Prague time", () => {
      expect(
        blockerTags(openSpace, new Date("2026-11-07T15:59:00Z"), settled())
      ).toEqual([]);
      expect(
        blockerTags(openSpace, new Date("2026-11-07T16:00:00Z"), settled())
      ).toEqual(["OpenSpaceClosedToday"]);
    });

    test("closes at 17:00 Prague summer time", () => {
      const summer = { ...openSpace, date: "2026-07-01" };

      expect(
        blockerTags(summer, new Date("2026-07-01T14:59:00Z"), settled())
      ).toEqual([]);
      expect(
        blockerTags(summer, new Date("2026-07-01T15:00:00Z"), settled())
      ).toEqual(["OpenSpaceClosedToday"]);
    });

    test("doesn't affect tomorrow or a Reserved Desk", () => {
      const evening = new Date("2026-11-07T18:00:00Z");

      expect(
        blockerTags({ ...openSpace, date: "2026-11-08" }, evening, settled())
      ).toEqual([]);
      expect(blockerTags(reservedDesk, evening, settled())).toEqual([]);
    });
  });

  describe("Reserved Desk workstation", () => {
    const requiresWorkstation = settled({
      unavailableDates: [today],
      reservedDeskWorkstationRequiredDates: [today],
      unavailableMonitorOptions: ["2x27-qhd"],
    });

    test("requires the first free workstation when no bare desk is left", () => {
      const enablement = coworkEnablement(reservedDesk, {
        now: morning,
        offerings,
        availability: requiresWorkstation,
      });

      expect(enablement.workstationRequired).toBe(true);
      expect(enablement.requiredWorkstation).toEqual(Option.some("2x32-qhd"));
      expect(enablement.workstations.map(({ id }) => id)).toEqual([
        "2x27-qhd",
        "2x32-qhd",
        "2x27-4k",
        "2x32-4k",
      ]);
      expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
        "WorkstationRequired",
      ]);
    });

    test("adds the required workstation and removes it once it isn't required", () => {
      const enablement = coworkEnablement(reservedDesk, {
        now: morning,
        offerings,
        availability: requiresWorkstation,
      });
      const added = normalizeCoworkWorkstation(
        reservedDesk,
        requiresWorkstation,
        enablement
      );

      expect(added.workstation).toEqual(
        Option.some({ option: "2x32-qhd", origin: "requirement" })
      );
      expect(blockerTags(added, morning, requiresWorkstation)).toEqual([]);

      const bareDesk = settled();
      const removed = normalizeCoworkWorkstation(
        added,
        bareDesk,
        coworkEnablement(added, {
          now: morning,
          offerings,
          availability: bareDesk,
        })
      );
      expect(removed.workstation).toEqual(Option.none());
    });

    test("replaces a taken choice and keeps the customer's free one", () => {
      const taken = selectCoworkWorkstation(
        reservedDesk,
        Option.some("2x27-qhd")
      );
      const replaced = normalizeCoworkWorkstation(
        taken,
        requiresWorkstation,
        coworkEnablement(taken, {
          now: morning,
          offerings,
          availability: requiresWorkstation,
        })
      );
      expect(replaced.workstation).toEqual(
        Option.some({ option: "2x32-qhd", origin: "customer" })
      );

      const bareDesk = settled();
      expect(
        normalizeCoworkWorkstation(
          replaced,
          bareDesk,
          coworkEnablement(replaced, {
            now: morning,
            offerings,
            availability: bareDesk,
          })
        )
      ).toBe(replaced);
    });

    test("blocks a taken optional workstation without replacing it", () => {
      const takenOnly = settled({ unavailableMonitorOptions: ["2x27-4k"] });
      const draft = selectCoworkWorkstation(
        reservedDesk,
        Option.some("2x27-4k")
      );
      const enablement = coworkEnablement(draft, {
        now: morning,
        offerings,
        availability: takenOnly,
      });

      expect(normalizeCoworkWorkstation(draft, takenOnly, enablement)).toBe(
        draft
      );
      expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
        "WorkstationUnavailable",
      ]);
    });

    test("stays required and blocked when every workstation is taken", () => {
      const noneFree = settled({
        reservedDeskWorkstationRequiredDates: [today],
        unavailableMonitorOptions: [
          "2x27-qhd",
          "2x32-qhd",
          "2x27-4k",
          "2x32-4k",
        ],
      });
      const enablement = coworkEnablement(reservedDesk, {
        now: morning,
        offerings,
        availability: noneFree,
      });

      expect(enablement.requiredWorkstation).toEqual(Option.none());
      expect(
        normalizeCoworkWorkstation(reservedDesk, noneFree, enablement)
      ).toBe(reservedDesk);
      expect(enablement.blockers.map(({ _tag }) => _tag)).toEqual([
        "WorkstationRequired",
      ]);
    });

    test("waits for the date's queries before normalizing", () => {
      const pending = { ...requiresWorkstation, selection: Option.none() };

      expect(
        normalizeCoworkWorkstation(
          reservedDesk,
          pending,
          coworkEnablement(reservedDesk, {
            now: morning,
            offerings,
            availability: pending,
          })
        )
      ).toBe(reservedDesk);
    });
  });

  test("shows only the selected date's notices", () => {
    const notice = { date: today, startsAt: "10:00", endsAt: "12:00" };
    const enablement = coworkEnablement(defaultCoworkDraft(today, offerings), {
      now: morning,
      offerings,
      availability: settled({
        notices: [notice, { ...notice, date: "2026-11-08" }],
      }),
    });

    expect(enablement.notices).toEqual([notice]);
  });
});
