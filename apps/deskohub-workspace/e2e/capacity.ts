import type { Reservation } from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import { workspaceMeetingRoomReservationTableTag } from "@/features/checkout/backend/reservation/workspace-table-selection";
import {
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import {
  workspaceE2EConcurrentRunTarget,
  workspaceE2EFullDateAllocation,
  workspaceE2EProviderHeadroomRuns,
} from "./allocation";

const provisionedRunCapacity =
  workspaceE2EConcurrentRunTarget + workspaceE2EProviderHeadroomRuns;

export const workspaceE2EMaximumSameDateCoworkReservations = {
  basic: 4,
  plus: 1,
  profi: 1,
} as const;

export const getWorkspaceE2ECapacityInterval = (now = new Date()) => {
  const startDate = new Date(now);
  startDate.setUTCDate(
    startDate.getUTCDate() + workspaceE2EFullDateAllocation.fromOffsetDays
  );
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(now);
  endDate.setUTCDate(
    endDate.getUTCDate() + workspaceE2EFullDateAllocation.toOffsetDays + 1
  );
  endDate.setUTCHours(0, 0, 0, 0);
  return { endDate, startDate };
};

type CapacityGroup = {
  readonly id: string;
  readonly requiredAvailableSeatCount?: number;
  readonly requiredAvailableTableCount?: number;
  readonly requiredSeatCount?: number;
  readonly requiredTableCount?: number;
  readonly requiredTags: readonly string[];
};

const capacityGroups: readonly CapacityGroup[] = [
  {
    id: "tier:basic",
    requiredAvailableSeatCount:
      (workspaceE2EProviderHeadroomRuns + 1) *
      workspaceE2EMaximumSameDateCoworkReservations.basic,
    requiredSeatCount:
      provisionedRunCapacity *
      workspaceE2EMaximumSameDateCoworkReservations.basic,
    requiredTags: ["tier:basic"],
  },
  {
    id: "tier:plus",
    requiredAvailableSeatCount:
      (workspaceE2EProviderHeadroomRuns + 1) *
      workspaceE2EMaximumSameDateCoworkReservations.plus,
    requiredSeatCount:
      provisionedRunCapacity *
      workspaceE2EMaximumSameDateCoworkReservations.plus,
    requiredTags: ["tier:plus"],
  },
  {
    id: "tier:profi",
    requiredTags: ["tier:profi"],
  },
  ...workspaceProductMonitorOptions.map(
    (monitorOption): CapacityGroup => ({
      id: `tier:profi/monitor:${monitorOption}`,
      requiredAvailableSeatCount:
        (workspaceE2EProviderHeadroomRuns + 1) *
        workspaceE2EMaximumSameDateCoworkReservations.profi,
      requiredSeatCount:
        provisionedRunCapacity *
        workspaceE2EMaximumSameDateCoworkReservations.profi,
      requiredTags: [
        "tier:profi",
        ...workspaceProductMonitorOptionTableTags[monitorOption],
      ],
    })
  ),
  {
    id: workspaceMeetingRoomReservationTableTag,
    requiredAvailableTableCount: 1,
    requiredTableCount: 2,
    requiredTags: [workspaceMeetingRoomReservationTableTag],
  },
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

export const makeWorkspaceE2ECapacityReport = ({
  from,
  reservations,
  tables,
  to,
}: {
  readonly from: Date;
  readonly reservations: readonly Reservation[];
  readonly tables: readonly Table[];
  readonly to: Date;
}): WorkspaceE2ECapacityReport => {
  const groups = capacityGroups.map((group) => {
    const activeVisibleTables = tables.filter(
      (table) =>
        table.enabled === true &&
        table.display === true &&
        group.requiredTags.every((tag) => table.tags?.includes(tag))
    );
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
    const {
      peakActiveReservationSeatCount,
      peakActiveReservationTableCount,
    } = getPeakActiveReservationUsage(activeReservations);
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

  return {
    groups,
    meetsRequiredCapacity: groups.every(
      ({ meetsRequiredCapacity }) => meetsRequiredCapacity
    ),
    provisionedRunCapacity,
    supportedConcurrentRuns: workspaceE2EConcurrentRunTarget,
  };
};

const parsePositiveInteger = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const intervalsOverlap = (reservation: Reservation, from: Date, to: Date) => {
  const startsAt = Date.parse(reservation.startDate);
  const endsAt = Date.parse(reservation.endDate);
  return startsAt < to.getTime() && endsAt > from.getTime();
};

const getPeakActiveReservationUsage = (
  reservations: readonly Reservation[]
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
