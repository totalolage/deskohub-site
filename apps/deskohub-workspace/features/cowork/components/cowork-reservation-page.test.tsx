import { beforeEach, expect, mock, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import Link from "next/link";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  type NormalizedCoworkReservationOrder,
  normalizedBasicCoworkReservationOrderSchema,
  normalizedOpenSpaceCoworkReservationOrderSchema,
  normalizedReservedDeskCoworkReservationOrderSchema,
} from "@/features/reservation/cowork-reservation";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { Button } from "@/shared/components/ui/button";
import type { CoworkReservationForm } from "./cowork-reservation-form";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

const loadAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests)
);

mock.module(
  "@/features/checkout/backend/checkout/checkout-pricing.service",
  () => ({
    CheckoutPricingService: { Live: Layer.empty },
  })
);
mock.module("@/features/reservation/backend/advertised-prices.server", () => ({
  loadAdvertisedPrices,
}));

const { CoworkOfferReplaced, renderCoworkReservationContent } = await import(
  "./cowork-reservation-page"
);

beforeEach(() => mock.clearAllMocks());

const stubWorkspaceInstant = (run: () => Promise<void>): Promise<void> => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  return run().finally(() => {
    Temporal.Now.instant = originalNow;
  });
};

const decodeLegacyBasicReservation = Schema.decodeUnknownSync(
  normalizedBasicCoworkReservationOrderSchema
);

const decodeOpenSpaceReservation = Schema.decodeUnknownSync(
  normalizedOpenSpaceCoworkReservationOrderSchema
);

const decodeReservedDeskReservation = Schema.decodeUnknownSync(
  normalizedReservedDeskCoworkReservationOrderSchema
);

/**
 * Locates the restart Button and returns its direct-child anchor's href.
 * A `next/link` `legacyBehavior` anchor wrapped inside the Button does not
 * count: only a plain document anchor as the Button's immediate child proves
 * document navigation.
 */
const getRestartButtonDirectChildAnchorHref = (
  node: ReactNode
): string | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const href = getRestartButtonDirectChildAnchorHref(child);
      if (href !== undefined) {
        return href;
      }
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return undefined;
  }
  if (node.type === Button) {
    const { children } = node.props;
    const anchor = Array.isArray(children) ? children[0] : children;
    if (
      isValidElement<{ href?: string }>(anchor) &&
      anchor.type === "a" &&
      anchor.props.href !== undefined
    ) {
      return anchor.props.href;
    }
    return undefined;
  }
  return getRestartButtonDirectChildAnchorHref(node.props.children);
};

test("preloads only the default selected cowork offer", async () =>
  stubWorkspaceInstant(async () => {
    const form = (await renderCoworkReservationContent({
      locale: "en-US",
      searchParams: {},
    })) as ReactElement<Parameters<typeof CoworkReservationForm>[0]>;

    expect(form.props.initialValues).toMatchObject({
      entryTier: "open-space",
      coffee: false,
      date: "2099-07-30",
    });

    expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
      {
        locale: "en-US",
        reservation: {
          kind: "cowork",
          details: {
            kind: "cowork",
            entryTier: "open-space",
            coffee: false,
            date: "2099-07-30",
          },
        },
      },
    ]);
  }));

test("preloads the selection resolved from reservation query values", async () => {
  const form = (await renderCoworkReservationContent({
    locale: "cs-CZ",
    searchParams: {
      entryTier: "reserved-desk",
      coffee: "true",
      date: "2099-08-01",
      monitorOption: "2x27-qhd",
    },
  })) as ReactElement<Parameters<typeof CoworkReservationForm>[0]>;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    date: "2099-08-01",
    monitorOption: "2x27-qhd",
    name: "",
    email: "",
    phone: "",
  });

  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
    {
      locale: "cs-CZ",
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          entryTier: "reserved-desk",
          workstation: true,
          date: "2099-08-01",
        },
      },
    },
  ]);
});

test("preloads the bare reserved-desk query selection without a workstation", async () => {
  const form = (await renderCoworkReservationContent({
    locale: "en-US",
    searchParams: {
      entryTier: "reserved-desk",
      date: "2099-08-01",
    },
  })) as ReactElement<Parameters<typeof CoworkReservationForm>[0]>;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    date: "2099-08-01",
  });

  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
    {
      locale: "en-US",
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          entryTier: "reserved-desk",
          workstation: false,
          date: "2099-08-01",
        },
      },
    },
  ]);
});

test("offers the restart state for a legacy basic reservation in en-US", async () => {
  const legacyBasicReservation = decodeLegacyBasicReservation({
    kind: "cowork",
    name: "Jan Novák",
    email: "jan@example.cz",
    phone: "+420712345678",
    billing: defaultReservationBillingSelection,
    entryTier: "basic",
    coffee: false,
    date: "2099-08-01",
  }) as NormalizedCoworkReservationOrder;

  const markup = renderToString(
    await renderCoworkReservationContent({
      locale: "en-US",
      initialReservation: legacyBasicReservation,
      searchParams: {},
    })
  );

  expect(loadAdvertisedPrices).not.toHaveBeenCalled();
  expect(markup).toContain(
    "This cowork offer is no longer available. Please start a new reservation with the current offers."
  );
  expect(markup).toContain(`<a href="/en-US/reservation/cowork"`);
  expect(
    getRestartButtonDirectChildAnchorHref(
      CoworkOfferReplaced({ locale: "en-US" })
    )
  ).toBe("/en-US/reservation/cowork");
});

test("offers the restart state for a legacy basic reservation in cs-CZ", async () => {
  const legacyBasicReservation = decodeLegacyBasicReservation({
    kind: "cowork",
    name: "Jan Novák",
    email: "jan@example.cz",
    phone: "+420712345678",
    billing: defaultReservationBillingSelection,
    entryTier: "basic",
    coffee: false,
    date: "2099-08-01",
  }) as NormalizedCoworkReservationOrder;

  const markup = renderToString(
    await renderCoworkReservationContent({
      locale: "cs-CZ",
      initialReservation: legacyBasicReservation,
      searchParams: {},
    })
  );

  expect(loadAdvertisedPrices).not.toHaveBeenCalled();
  expect(markup).toContain(
    "Tato cowork nabídka už není dostupná. Začněte prosím novou rezervaci s aktuální nabídkou."
  );
  expect(markup).toContain(`<a href="/cs-CZ/reservation/cowork"`);
  expect(
    getRestartButtonDirectChildAnchorHref(
      CoworkOfferReplaced({ locale: "cs-CZ" })
    )
  ).toBe("/cs-CZ/reservation/cowork");
});

test("rejects a Link legacyBehavior wrapped anchor as restart navigation", () => {
  const linkWrappedRestartButton = (
    <Button asChild>
      <Link legacyBehavior href="/en-US/reservation/cowork">
        <a href="/en-US/reservation/cowork">Restart</a>
      </Link>
    </Button>
  );

  expect(
    getRestartButtonDirectChildAnchorHref(linkWrappedRestartButton)
  ).toBeUndefined();
});

test("restores a signed current-tier open-space reservation into the form", async () => {
  const restoredOpenSpaceReservation = decodeOpenSpaceReservation({
    kind: "cowork",
    name: "Jan Novák",
    email: "jan@example.cz",
    phone: "+420712345678",
    billing: defaultReservationBillingSelection,
    entryTier: "open-space",
    coffee: true,
    date: "2099-08-01",
  }) as NormalizedCoworkReservationOrder;

  const form = (await renderCoworkReservationContent({
    locale: "en-US",
    initialReservation: restoredOpenSpaceReservation,
    searchParams: {},
  })) as ReactElement<Parameters<typeof CoworkReservationForm>[0]>;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "open-space",
    coffee: true,
    date: "2099-08-01",
    name: "Jan Novák",
    email: "jan@example.cz",
  });
  expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
    {
      locale: "en-US",
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: true,
          date: "2099-08-01",
        },
      },
    },
  ]);
});

test("restores a signed current-tier reserved-desk reservation into the form", async () => {
  const restoredReservedDeskReservation = decodeReservedDeskReservation({
    kind: "cowork",
    name: "Jan Novák",
    email: "jan@example.cz",
    phone: "+420712345678",
    billing: defaultReservationBillingSelection,
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2099-08-01",
  }) as NormalizedCoworkReservationOrder;

  const form = (await renderCoworkReservationContent({
    locale: "en-US",
    initialReservation: restoredReservedDeskReservation,
    searchParams: {},
  })) as ReactElement<Parameters<typeof CoworkReservationForm>[0]>;

  expect(form.props.initialValues).toMatchObject({
    entryTier: "reserved-desk",
    coffee: true,
    monitorOption: "2x27-qhd",
    date: "2099-08-01",
  });
  expect(loadAdvertisedPrices).toHaveBeenCalledTimes(1);
  expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual([
    {
      locale: "en-US",
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          entryTier: "reserved-desk",
          workstation: true,
          date: "2099-08-01",
        },
      },
    },
  ]);
});
