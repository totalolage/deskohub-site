import type {
  CustomerBookingSelection,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import {
  type CoworkAvailability,
  type CoworkDraft,
  type CoworkEnablement,
  coworkEnablement,
  normalizeCoworkWorkstation,
  toCoworkSelection,
} from "../selection/cowork-selection";
import { quotableSelection } from "./booking-family-view";

/** What the cowork screen shows for its draft and the availability read. */
export type CoworkBookingModel = {
  /**
   * The draft with its workstation fitted to the availability; the screen
   * keeps it once it differs from the one it holds.
   */
  readonly draft: CoworkDraft;
  readonly enablement: CoworkEnablement;
  readonly selection: CustomerBookingSelection;
  /** The selection to quote, while it may still be bookable. */
  readonly quotable: Option.Option<CustomerBookingSelection>;
};

export const coworkBookingModel = ({
  draft,
  now,
  offerings,
  availability,
}: {
  readonly draft: CoworkDraft;
  readonly now: Date;
  readonly offerings: ReadonlyArray<CustomerOffering>;
  /** Settled reads of `coworkAvailabilityQueries(draft, today)`. */
  readonly availability: CoworkAvailability;
}): CoworkBookingModel => {
  const context = { now, offerings, availability };
  const read = coworkEnablement(draft, context);
  const fitted = normalizeCoworkWorkstation(draft, availability, read);
  // A fitted workstation changes the selection, whose availability the
  // screen reads next; until then the offer counts as loading.
  const enablement =
    fitted === draft
      ? read
      : coworkEnablement(fitted, {
          ...context,
          availability: { ...availability, selection: Option.none() },
        });
  const selection = toCoworkSelection(fitted);
  return {
    draft: fitted,
    enablement,
    selection,
    quotable: quotableSelection(Option.some(selection), enablement.blockers),
  };
};
