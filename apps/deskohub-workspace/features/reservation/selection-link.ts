import {
  hasReservationSelectionSearchParams,
  type ReservationSelectionSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import type { SupportedSearchParams } from "@/shared/utils";

/**
 * A reservation family's selection link: the query parameters a reservation
 * page link names, declared once.
 *
 * The parameter list decides what counts as a selection in a URL, which form
 * values a link sets, and the order a link writes its parameters in.
 */
export const defineSelectionLink = <
  const Kind extends WorkspaceReservationKind,
  const Param extends string,
  Values extends { readonly [Name in Param]?: unknown },
  Selection extends { readonly [Name in Param]?: unknown },
  ReadArgs extends readonly unknown[],
  Stored,
>(definition: {
  readonly kind: Kind;
  /** The selection parameters, in the order links name them. */
  readonly params: readonly Param[];
  /** Retired parameter names the link still reads but never writes. */
  readonly legacyParams?: readonly string[];
  /**
   * The form values a link opens with. Parameters the link leaves out or
   * names with an unusable value take the page's defaults.
   */
  readonly read: (
    searchParams: SupportedSearchParams,
    ...args: ReadArgs
  ) => Values;
  /**
   * A selection as link parameters. A parameter written as `undefined` stays
   * out of the link, so the page fills it.
   */
  readonly write: (selection: Selection) => {
    readonly [Name in Param]: string | undefined;
  };
  /** A stored reservation's selection, or `undefined` when no link can reopen it. */
  readonly fromStored: (stored: Stored) => Selection | undefined;
}) => {
  const { kind, params, read, write, fromStored } = definition;
  const namedParams = [...params, ...(definition.legacyParams ?? [])];

  const readSelection = (
    searchParams: SupportedSearchParams,
    ...args: ReadArgs
  ): Pick<Values, Param> => {
    const values = read(searchParams, ...args);
    return Object.fromEntries(
      params.map((name) => [name, values[name]])
    ) as Pick<Values, Param>;
  };

  return {
    kind,
    params,
    read,
    /** The selection a link names, as form values. */
    readSelection,
    /**
     * Restored form values with the selection a URL names beside them.
     *
     * The Pay page links back to the reservation page with the signed
     * restoration token alone, so selection parameters beside that token are
     * the customer's edits after returning: any of them replaces the whole
     * restored selection, while the restoration keeps the checkout, its hold
     * replacement, the contact details, and the discount intent.
     */
    restore: <Restored extends Pick<Values, Param> | undefined>(
      restored: Restored,
      searchParams: SupportedSearchParams,
      ...args: ReadArgs
    ): Restoration<Restored, Pick<Values, Param>> => {
      const restoration: object | undefined =
        restored &&
        hasReservationSelectionSearchParams(searchParams, namedParams)
          ? { ...restored, ...readSelection(searchParams, ...args) }
          : restored;
      return restoration as Restoration<Restored, Pick<Values, Param>>;
    },
    /** A selection as link parameters, in the declared order. */
    write: (
      selection: Selection
    ): ReservationSelectionSearchParams & {
      readonly [Name in Param]: string | undefined;
    } => {
      const written = write(selection);
      return Object.fromEntries(
        params.map((name) => [name, written[name]])
      ) as { readonly [Name in Param]: string | undefined };
    },
    /** A stored reservation's selection, ready for a reservation page link. */
    fromStored: (
      stored: Stored
    ): ({ readonly kind: Kind } & Selection) | undefined => {
      const selection = fromStored(stored);
      return selection && { kind, ...selection };
    },
  };
};

/** Restored values with their selection fields replaced by a link's. */
type Restoration<Restored, Selection> = Restored extends undefined
  ? undefined
  : Omit<Restored, keyof Selection> & Selection;

/** A selection one family's link can name, tagged with its family. */
export type LinkedSelection<
  Link extends {
    readonly kind: WorkspaceReservationKind;
    readonly write: (selection: never) => unknown;
  },
> = { readonly kind: Link["kind"] } & Parameters<Link["write"]>[0];
