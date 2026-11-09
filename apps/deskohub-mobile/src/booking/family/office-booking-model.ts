import type {
  CustomerAvailability,
  CustomerBookingSelection,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import {
  clampOfficeDraft,
  type OfficeDraft,
  type OfficeEnablement,
  type OfficeOffering,
  officeEnablement,
  toOfficeSelection,
} from "../selection/office-selection";
import { quotableSelection } from "./booking-family-view";

/** The office offering of the catalog, when offices are offered. */
export const officeOfferingOf = (
  offerings: ReadonlyArray<CustomerOffering>
): Option.Option<OfficeOffering> =>
  Option.fromNullishOr(
    offerings.find(
      (offering): offering is OfficeOffering => offering.family === "office"
    )
  );

/** What the office screen shows for its draft and the availability read. */
export type OfficeBookingModel = {
  /** The draft with its days and seats within what the first day allows. */
  readonly draft: OfficeDraft;
  readonly enablement: OfficeEnablement;
  readonly selection: CustomerBookingSelection;
  readonly quotable: Option.Option<CustomerBookingSelection>;
};

export const officeBookingModel = ({
  draft,
  now,
  offering,
  availability,
}: {
  readonly draft: OfficeDraft;
  readonly now: Date;
  readonly offering: OfficeOffering;
  /** Settled read of `officeAvailabilityQuery(today)`. */
  readonly availability: Option.Option<CustomerAvailability>;
}): OfficeBookingModel => {
  const context = { now, offering, availability };
  const fitted = clampOfficeDraft(draft, officeEnablement(draft, context));
  const enablement = officeEnablement(fitted, context);
  const selection = toOfficeSelection(fitted);
  return {
    draft: fitted,
    enablement,
    selection,
    quotable: quotableSelection(Option.some(selection), enablement.blockers),
  };
};
