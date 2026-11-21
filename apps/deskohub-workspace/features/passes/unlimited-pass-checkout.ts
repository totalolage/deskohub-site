import { Option, Schema } from "effect";
import {
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import { type PlainDate, plainDateStringSchema } from "@/shared/utils/temporal";
import { type PassTier, passTiers } from "./pass-offer";
import { unlimitedPassCheckoutPath } from "./routes";
import type { UnlimitedPassSelection } from "./unlimited-pass";

export type UnlimitedPassOptions =
  | Omit<Extract<UnlimitedPassSelection, { tier: "open-space" }>, "startDate">
  | Omit<
      Extract<UnlimitedPassSelection, { tier: "reserved-desk" }>,
      "startDate"
    >
  | Omit<
      Extract<UnlimitedPassSelection, { tier: "reserved-desk-workstation" }>,
      "startDate"
    >;

export type UnlimitedPassStartDates = {
  readonly "open-space": readonly PlainDate[];
  readonly "reserved-desk": readonly PlainDate[];
  readonly "reserved-desk-workstation": Readonly<
    Record<WorkspaceProductMonitorOption, readonly PlainDate[]>
  >;
};

const decodeStartDate = Schema.decodeUnknownOption(plainDateStringSchema);

export function unlimitedPassOptionsForTier(
  tier: PassTier
): UnlimitedPassOptions {
  switch (tier) {
    case "open-space":
      return { tier, coffee: false };
    case "reserved-desk":
      return { tier };
    case "reserved-desk-workstation":
      return { tier, monitorOption: workspaceProductMonitorOptions[0] };
  }
}

export function readUnlimitedPassSelection(query: {
  readonly tier?: string | string[];
  readonly startDate?: string | string[];
  readonly coffee?: string | string[];
  readonly monitorOption?: string | string[];
}): { readonly options: UnlimitedPassOptions; readonly startDate?: PlainDate } {
  const options = unlimitedPassOptionsForTier(
    passTiers.find((tier) => tier === query.tier) ?? "reserved-desk"
  );
  const startDate = Option.getOrUndefined(decodeStartDate(query.startDate));
  if (options.tier === "open-space") {
    return {
      options: { ...options, coffee: query.coffee === "true" },
      startDate,
    };
  }
  if (options.tier === "reserved-desk-workstation") {
    return {
      options: {
        ...options,
        monitorOption:
          workspaceProductMonitorOptions.find(
            (option) => option === query.monitorOption
          ) ?? options.monitorOption,
      },
      startDate,
    };
  }
  return { options, startDate };
}

export type UnlimitedPassOrderLink =
  | { readonly kind: "resume"; readonly orderId: OrderId }
  | { readonly kind: "replace"; readonly orderId: OrderId }
  | { readonly kind: "edit"; readonly predecessorOrderIds: readonly OrderId[] }
  | {
      readonly kind: "submitted";
      readonly orderId: OrderId;
      readonly predecessorOrderIds: readonly OrderId[];
    };

export const unlimitedCheckoutPredecessorLimit = 8;

export function getUnlimitedCheckoutPredecessors(
  order?: UnlimitedPassOrderLink
) {
  if (!order) return [];
  switch (order.kind) {
    case "edit":
      return order.predecessorOrderIds;
    case "submitted":
      return [order.orderId, ...order.predecessorOrderIds];
    case "replace":
    case "resume":
      return [order.orderId];
  }
}

export function getUnlimitedPassChoosePath(
  locale: Locale,
  options: UnlimitedPassOptions,
  startDate?: PlainDate,
  order?: UnlimitedPassOrderLink,
  renewsPassId?: OrderId
) {
  const query = new URLSearchParams({
    tier: options.tier,
    ...(renewsPassId && { renew: renewsPassId }),
    ...(startDate !== undefined && { startDate }),
    ...(order?.kind === "resume" && { order: order.orderId }),
    ...(order?.kind === "replace" && { supersedeOrder: order.orderId }),
    ...(order?.kind === "submitted" && { submittedOrder: order.orderId }),
    ...(options.tier === "open-space" && options.coffee && { coffee: "true" }),
    ...(options.tier === "reserved-desk-workstation" && {
      monitorOption: options.monitorOption,
    }),
  });
  if (order?.kind === "submitted" || order?.kind === "edit") {
    for (const orderId of order.predecessorOrderIds) {
      query.append("predecessorOrder", orderId);
    }
  }
  return `/${locale}${unlimitedPassCheckoutPath}?${query}`;
}

export function getUnlimitedPassDetailsPath(
  locale: Locale,
  selection: UnlimitedPassSelection,
  order?: UnlimitedPassOrderLink,
  renewsPassId?: OrderId
) {
  const path = getUnlimitedPassChoosePath(
    locale,
    selection,
    selection.startDate,
    order,
    renewsPassId
  );
  return `${path}&step=details`;
}

export function getUnlimitedPassPayPath(locale: Locale, orderId: OrderId) {
  const query = new URLSearchParams({ order: orderId, step: "pay" });
  return `/${locale}${unlimitedPassCheckoutPath}?${query}`;
}

export function availableUnlimitedPassStarts(
  starts: UnlimitedPassStartDates,
  options: UnlimitedPassOptions
) {
  return options.tier === "reserved-desk-workstation"
    ? starts[options.tier][options.monitorOption]
    : starts[options.tier];
}

export type UnlimitedPassAvailabilityData = {
  readonly status: "ready";
  readonly today: PlainDate;
  readonly lastStartDate: PlainDate;
  readonly starts: UnlimitedPassStartDates;
};
