import type { DotyposReservation, DotyposTable } from "@deskohub/dotypos";
import "@/shared/polyfills/temporal";
import {
  isWorkspaceCoworkTableCandidate,
  type WorkspaceCoworkTableCandidateQuery,
  workspaceCoworkOpenSpaceTableTag,
  workspaceCoworkReservedDeskTableTag,
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation/workspace-table-selection";
import {
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { temporalPlainDateToDate } from "@/shared/utils/temporal";
import {
  getWorkspaceE2ECandidateDate,
  workspaceE2EConcurrentRunTarget,
  workspaceE2EFullDateAllocation,
  workspaceE2EProviderHeadroomRuns,
} from "./allocation";
import { workspaceE2EOfficeReservationSeats } from "./office";

const provisionedRunCapacity =
  workspaceE2EConcurrentRunTarget + workspaceE2EProviderHeadroomRuns;

export const workspaceE2EMaximumSameDateCoworkReservations = {
  "open-space": 4,
  "reserved-desk": 1,
} as const;

export const getWorkspaceE2EDateInterval = ({
  fromDate,
  toDate,
}: {
  readonly fromDate: string;
  readonly toDate: string;
}) => {
  const timeZone = workspaceSiteConstants.location.timeZone;
  const midnight = Temporal.PlainTime.from("00:00");
  const startDate = temporalPlainDateToDate({
    date: Temporal.PlainDate.from(fromDate),
    plainTime: midnight,
    timeZone,
  });
  const endDate = temporalPlainDateToDate({
    date: Temporal.PlainDate.from(toDate).add({ days: 1 }),
    plainTime: midnight,
    timeZone,
  });
  return { endDate, startDate };
};

export const getWorkspaceE2ECapacityInterval = (now = new Date()) =>
  getWorkspaceE2EDateInterval({
    fromDate: getWorkspaceE2ECandidateDate(
      workspaceE2EFullDateAllocation.fromOffsetDays,
      now
    ),
    toDate: getWorkspaceE2ECandidateDate(
      workspaceE2EFullDateAllocation.toOffsetDays,
      now
    ),
  });

type CapacityGroup = {
  readonly candidateQuery?: WorkspaceCoworkTableCandidateQuery;
  readonly id: string;
  readonly requiredAvailableSeatCount?: number;
  readonly requiredAvailableTableCount?: number;
  readonly requiredSeatCount?: number;
  readonly requiredTableCount?: number;
  readonly requiredTags: readonly string[];
};

const reservedDeskMaximum =
  workspaceE2EMaximumSameDateCoworkReservations["reserved-desk"];

const newSaleCapacityGroups: readonly CapacityGroup[] = [
  {
    candidateQuery: { entryTier: "open-space" },
    id: "open-space",
    requiredAvailableSeatCount:
      (workspaceE2EProviderHeadroomRuns + 1) *
      workspaceE2EMaximumSameDateCoworkReservations["open-space"],
    requiredSeatCount:
      provisionedRunCapacity *
      workspaceE2EMaximumSameDateCoworkReservations["open-space"],
    requiredTags: [workspaceCoworkOpenSpaceTableTag],
  },
  {
    candidateQuery: { entryTier: "reserved-desk" },
    id: "reserved-desk",
    requiredAvailableSeatCount:
      (workspaceE2EProviderHeadroomRuns + 1) * reservedDeskMaximum,
    requiredSeatCount: provisionedRunCapacity * reservedDeskMaximum,
    requiredTags: [workspaceCoworkReservedDeskTableTag],
  },
  ...workspaceProductMonitorOptions.map(
    (monitorOption): CapacityGroup => ({
      candidateQuery: { entryTier: "reserved-desk", monitorOption },
      id: `reserved-desk/monitor:${monitorOption}`,
      requiredAvailableSeatCount:
        (workspaceE2EProviderHeadroomRuns + 1) * reservedDeskMaximum,
      requiredSeatCount: provisionedRunCapacity * reservedDeskMaximum,
      requiredTags: [
        workspaceCoworkReservedDeskTableTag,
        ...workspaceProductMonitorOptionTableTags[monitorOption],
      ],
    })
  ),
  {
    id: workspaceMeetingRoomReservationTableTag,
    requiredAvailableTableCount: 1,
    requiredTableCount: provisionedRunCapacity,
    requiredTags: [workspaceMeetingRoomReservationTableTag],
  },
  {
    id: workspaceOfficeReservationTableTag,
    requiredSeatCount: workspaceE2EOfficeReservationSeats,
    requiredTableCount: 1,
    requiredTags: [workspaceOfficeReservationTableTag],
  },
];

/**
 * Report-only visibility pools for tables still carrying legacy `tier:*` tags.
 * These groups carry no required capacity and are never part of the new-sale
 * preflight, so unassigned saleable labels fail closed instead of being propped
 * up by historical tags.
 */
export const workspaceE2ELegacyTierCleanupCapacityGroups: readonly CapacityGroup[] =
  [
    { id: "tier:basic", requiredTags: ["tier:basic"] },
    { id: "tier:plus", requiredTags: ["tier:plus"] },
    { id: "tier:profi", requiredTags: ["tier:profi"] },
    ...workspaceProductMonitorOptions.map(
      (monitorOption): CapacityGroup => ({
        id: `tier:profi/monitor:${monitorOption}`,
        requiredTags: [
          "tier:profi",
          ...workspaceProductMonitorOptionTableTags[monitorOption],
        ],
      })
    ),
  ];

export type WorkspaceE2ECapacityGroupReport = {
  readonly activeVisibleTableCount: number;
  readonly activeReservationCount: number;
  readonly activeReservationSeatCount: number;
  readonly assignableTableCount: number;
  readonly availableSeatCount: number;
  readonly availableTableCount: number;
  readonly id: string;
  readonly meetsRequiredCapacity: boolean;
  readonly peakActiveReservationSeatCount: number;
  readonly peakActiveReservationTableCount: number;
  readonly requiredAvailableSeatCount?: number;
  readonly requiredAvailableTableCount?: number;
  readonly requiredSeatCount?: number;
  readonly requiredTableCount?: number;
  readonly requiredTags: readonly string[];
  readonly seatCounts: readonly number[];
  readonly totalSeatCount: number;
};

export type WorkspaceE2ECapacityReport = {
  readonly groups: readonly WorkspaceE2ECapacityGroupReport[];
  readonly meetsRequiredCapacity: boolean;
  readonly provisionedRunCapacity: number;
  readonly supportedConcurrentRuns: number;
};

export const getWorkspaceE2ECapacityFailures = (
  report: WorkspaceE2ECapacityReport
) =>
  report.groups.flatMap((group) =>
    group.meetsRequiredCapacity
      ? []
      : [
          {
            activeReservationCount: group.activeReservationCount,
            activeVisibleTableCount: group.activeVisibleTableCount,
            assignableTableCount: group.assignableTableCount,
            availableSeatCount: group.availableSeatCount,
            availableTableCount: group.availableTableCount,
            id: group.id,
            peakActiveReservationSeatCount:
              group.peakActiveReservationSeatCount,
            peakActiveReservationTableCount:
              group.peakActiveReservationTableCount,
            requiredAvailableSeatCount: group.requiredAvailableSeatCount,
            requiredAvailableTableCount: group.requiredAvailableTableCount,
            requiredSeatCount: group.requiredSeatCount,
            requiredTableCount: group.requiredTableCount,
            totalSeatCount: group.totalSeatCount,
          },
        ]
  );

const makeWorkspaceE2ECapacityGroupReports = ({
  from,
  groups,
  reservations,
  tables,
  to,
}: {
  readonly from: Date;
  readonly groups: readonly CapacityGroup[];
  readonly reservations: readonly DotyposReservation[];
  readonly tables: readonly DotyposTable[];
  readonly to: Date;
}): WorkspaceE2ECapacityGroupReport[] =>
  groups.map((group) => {
    const activeVisibleTables = tables.filter((table) => {
      if (table.enabled !== true || table.display !== true) return false;
      const tableTags = new Set(table.tags ?? []);
      return group.candidateQuery
        ? isWorkspaceCoworkTableCandidate(tableTags, group.candidateQuery)
        : group.requiredTags.every((tag) => tableTags.has(tag));
    });
    const assignableTables = activeVisibleTables.flatMap((table) => {
      const id = table.id?.trim();
      const seats = parsePositiveInteger(table.seats);
      return id && seats ? [{ id, seats }] : [];
    });
    const tableIds = new Set(assignableTables.map(({ id }) => id));
    const activeReservations = reservations.filter(
      (reservation) =>
        reservation.status !== "CANCELLED" &&
        Boolean(reservation._tableId && tableIds.has(reservation._tableId)) &&
        intervalsOverlap(reservation, from, to)
    );
    const seatCounts = assignableTables
      .map(({ seats }) => seats)
      .toSorted((left, right) => left - right);
    const totalSeatCount = seatCounts.reduce(
      (total, seats) => total + seats,
      0
    );
    const activeReservationSeatCount = activeReservations.reduce(
      (total, reservation) =>
        total + (parsePositiveInteger(reservation.seats) ?? 0),
      0
    );
    const { peakActiveReservationSeatCount, peakActiveReservationTableCount } =
      getPeakActiveReservationUsage(activeReservations);
    const availableSeatCount = Math.max(
      0,
      totalSeatCount - peakActiveReservationSeatCount
    );
    const availableTableCount = Math.max(
      0,
      assignableTables.length - peakActiveReservationTableCount
    );
    const meetsRequiredCapacity =
      (group.requiredSeatCount === undefined ||
        totalSeatCount >= group.requiredSeatCount) &&
      (group.requiredTableCount === undefined ||
        assignableTables.length >= group.requiredTableCount) &&
      (group.requiredAvailableSeatCount === undefined ||
        availableSeatCount >= group.requiredAvailableSeatCount) &&
      (group.requiredAvailableTableCount === undefined ||
        availableTableCount >= group.requiredAvailableTableCount);

    return {
      activeVisibleTableCount: activeVisibleTables.length,
      activeReservationCount: activeReservations.length,
      activeReservationSeatCount,
      assignableTableCount: assignableTables.length,
      availableSeatCount,
      availableTableCount,
      id: group.id,
      meetsRequiredCapacity,
      peakActiveReservationSeatCount,
      peakActiveReservationTableCount,
      ...(group.requiredAvailableSeatCount === undefined
        ? {}
        : { requiredAvailableSeatCount: group.requiredAvailableSeatCount }),
      ...(group.requiredAvailableTableCount === undefined
        ? {}
        : { requiredAvailableTableCount: group.requiredAvailableTableCount }),
      ...(group.requiredSeatCount === undefined
        ? {}
        : { requiredSeatCount: group.requiredSeatCount }),
      ...(group.requiredTableCount === undefined
        ? {}
        : { requiredTableCount: group.requiredTableCount }),
      requiredTags: group.requiredTags,
      seatCounts,
      totalSeatCount,
    } satisfies WorkspaceE2ECapacityGroupReport;
  });

const makeWorkspaceE2ECapacityReportFromGroups = (
  groupReports: readonly WorkspaceE2ECapacityGroupReport[]
): WorkspaceE2ECapacityReport => ({
  groups: groupReports,
  meetsRequiredCapacity: groupReports.every(
    ({ meetsRequiredCapacity }) => meetsRequiredCapacity
  ),
  provisionedRunCapacity,
  supportedConcurrentRuns: workspaceE2EConcurrentRunTarget,
});

export const makeWorkspaceE2ECapacityReport = ({
  from,
  reservations,
  tables,
  to,
}: {
  readonly from: Date;
  readonly reservations: readonly DotyposReservation[];
  readonly tables: readonly DotyposTable[];
  readonly to: Date;
}): WorkspaceE2ECapacityReport =>
  makeWorkspaceE2ECapacityReportFromGroups(
    makeWorkspaceE2ECapacityGroupReports({
      from,
      groups: newSaleCapacityGroups,
      reservations,
      tables,
      to,
    })
  );

export const makeWorkspaceE2ELegacyTierCleanupCapacityReport = ({
  from,
  reservations,
  tables,
  to,
}: {
  readonly from: Date;
  readonly reservations: readonly DotyposReservation[];
  readonly tables: readonly DotyposTable[];
  readonly to: Date;
}): WorkspaceE2ECapacityReport =>
  makeWorkspaceE2ECapacityReportFromGroups(
    makeWorkspaceE2ECapacityGroupReports({
      from,
      groups: workspaceE2ELegacyTierCleanupCapacityGroups,
      reservations,
      tables,
      to,
    })
  );

const parsePositiveInteger = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const intervalsOverlap = (
  reservation: DotyposReservation,
  from: Date,
  to: Date
) => {
  const startsAt = Date.parse(reservation.startDate);
  const endsAt = Date.parse(reservation.endDate);
  return startsAt < to.getTime() && endsAt > from.getTime();
};

const getPeakActiveReservationUsage = (
  reservations: readonly DotyposReservation[]
) => {
  const events = reservations.flatMap((reservation) => {
    const tableId = reservation._tableId?.trim();
    const seats = parsePositiveInteger(reservation.seats) ?? 0;
    if (!tableId) return [];
    return [
      {
        at: Date.parse(reservation.startDate),
        seatDelta: seats,
        tableDelta: 1,
        tableId,
      },
      {
        at: Date.parse(reservation.endDate),
        seatDelta: -seats,
        tableDelta: -1,
        tableId,
      },
    ];
  });
  events.sort(
    (left, right) => left.at - right.at || left.tableDelta - right.tableDelta
  );

  let activeSeatCount = 0;
  let activeTableCount = 0;
  let peakActiveReservationSeatCount = 0;
  let peakActiveReservationTableCount = 0;
  const reservationCountByTableId = new Map<string, number>();
  for (const event of events) {
    activeSeatCount += event.seatDelta;
    const previousTableReservationCount =
      reservationCountByTableId.get(event.tableId) ?? 0;
    const tableReservationCount =
      previousTableReservationCount + event.tableDelta;
    if (previousTableReservationCount === 0 && tableReservationCount > 0) {
      activeTableCount += 1;
    }
    if (previousTableReservationCount > 0 && tableReservationCount === 0) {
      activeTableCount -= 1;
    }
    if (tableReservationCount === 0) {
      reservationCountByTableId.delete(event.tableId);
    } else {
      reservationCountByTableId.set(event.tableId, tableReservationCount);
    }
    peakActiveReservationSeatCount = Math.max(
      peakActiveReservationSeatCount,
      activeSeatCount
    );
    peakActiveReservationTableCount = Math.max(
      peakActiveReservationTableCount,
      activeTableCount
    );
  }

  return {
    peakActiveReservationSeatCount,
    peakActiveReservationTableCount,
  };
};
