import { beforeEach, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import type { OrderId } from "@/features/order";

let enabled = false;
let buyerSignedIn = true;
let submittedOrderCommitted = false;
let submittedGift = true;
let commitAfterContinuationRead = false;
let submittedStatusOnly = false;
let pendingRenewal = false;
const ownedOrder = "5413f44e-80ef-430e-9663-ddd7242a2ed0";
const submittedOrder = "5413f44e-80ef-430e-9663-ddd7242a2ed1";
const renewalSource = "5413f44e-80ef-430e-9663-ddd7242a2ed2";
const renewalSelection = {
  tier: "open-space",
  coffee: true,
  startDate: "2026-12-15",
};
const holderEmail = testEmailAddress("unlimited-route-holder");

beforeEach(() => {
  enabled = false;
  buyerSignedIn = true;
  submittedOrderCommitted = false;
  submittedGift = true;
  commitAfterContinuationRead = false;
  submittedStatusOnly = false;
  pendingRenewal = false;
});

mock.module(
  "@/features/passes/backend/cowork-passes-release-gate.server",
  () => ({
    isCoworkPassesPageOpenAfterConnection: async () => enabled,
  })
);
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (run: (locale: Locale) => unknown) => run("cs-CZ"),
}));
mock.module("@/features/passes/backend/pass-purchase-buyer", () => ({
  readPassPurchaseBuyer: () =>
    Effect.succeed(
      buyerSignedIn
        ? {
            kind: "linked",
            name: "Fixture Buyer",
            email: testEmailAddress("unlimited-route-buyer"),
          }
        : { kind: "signed-out" }
    ),
}));
mock.module("@/features/discounts/discount-code-entry.server", () => ({
  getDiscountCodeEntryEnabled: Effect.succeed(false),
}));
mock.module("@/features/passes/backend/unlimited-pass-purchase", () => ({
  readUnlimitedCheckoutRenewal: (passId: OrderId, resumePending: boolean) =>
    Effect.succeed(
      buyerSignedIn && passId === renewalSource
        ? {
            selection: renewalSelection,
            pendingOrderId:
              resumePending && pendingRenewal ? submittedOrder : undefined,
          }
        : undefined
    ),
  loadUnlimitedCheckoutContinuation: (orderId: OrderId) =>
    Effect.sync(() => {
      const owned =
        buyerSignedIn &&
        (orderId === ownedOrder ||
          (orderId === submittedOrder && submittedOrderCommitted));
      if (orderId === submittedOrder && commitAfterContinuationRead)
        submittedOrderCommitted = true;
      if (!owned) return undefined;
      if (orderId === submittedOrder && submittedStatusOnly)
        return { kind: "status", locale: "en-US" };
      return {
        kind: "details",
        locale: "cs-CZ",
        selection: { tier: "reserved-desk", startDate: "2026-12-01" },
        renewsPassId: pendingRenewal ? renewalSource : null,
        holderEmail:
          orderId === submittedOrder && !submittedGift
            ? undefined
            : holderEmail,
      };
    }),
}));
mock.module("@/features/passes/unlimited-checkout-actions", () => ({
  beginUnlimitedCheckout: mock(),
  getUnlimitedCheckoutAvailability: mock(),
  payUnlimitedCheckout: mock(),
  repriceUnlimitedCheckout: mock(),
}));
mock.module("@/features/passes/backend/entry-pack-order", () => ({
  readOwnedPassPurchaseOrderLocale: (orderId: OrderId, product: string) =>
    Effect.succeed(
      buyerSignedIn &&
        (orderId === ownedOrder ||
          (orderId === submittedOrder && submittedOrderCommitted)) &&
        product === "unlimited"
        ? "en-US"
        : undefined
    ),
}));

const { default: UnlimitedPassPage, generateMetadata } = await import("./page");

test.each([UnlimitedPassPage, generateMetadata])(
  "a closed release keeps an owned Unlimited order reachable in its issued locale (%p)",
  async (render) => {
    await expect(
      render({
        searchParams: Promise.resolve({ order: ownedOrder, step: "pay" }),
      })
    ).rejects.toHaveProperty(
      "digest",
      `NEXT_REDIRECT;replace;/en-US/reservation/status/${ownedOrder};307;`
    );
  }
);

test.each([UnlimitedPassPage, generateMetadata])(
  "a closed release rejects a submitted ID until its order is owned (%p)",
  async (render) => {
    const searchParams = Promise.resolve({
      tier: "open-space",
      startDate: "2026-12-15",
      step: "details",
      predecessorOrder: ownedOrder,
      submittedOrder,
    });
    await expect(render({ searchParams })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
    submittedOrderCommitted = true;
    await expect(render({ searchParams })).rejects.toHaveProperty(
      "digest",
      `NEXT_REDIRECT;replace;/en-US/reservation/status/${submittedOrder};307;`
    );
  }
);

test.each([UnlimitedPassPage, generateMetadata])(
  "a closed release returns one not-found response for all other visitors (%p)",
  async (render) => {
    for (const order of [
      undefined,
      crypto.randomUUID(),
      "malformed",
      [ownedOrder, ownedOrder],
    ]) {
      await expect(
        render({ searchParams: Promise.resolve({ order }) })
      ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    }
  }
);

test("the open checkout route serves noindex metadata and a selection page", async () => {
  enabled = true;
  const searchParams = Promise.resolve({
    tier: "reserved-desk-workstation",
    startDate: "2026-12-01",
  });
  expect(await generateMetadata({ searchParams })).toMatchObject({
    robots: { index: false, follow: false },
  });
  expect(await UnlimitedPassPage({ searchParams })).toBeTruthy();
});

const selectionQuery = {
  tier: "open-space",
  startDate: "2026-12-15",
  coffee: "true",
  step: "details",
};
const editedSelectionQuery = {
  ...selectionQuery,
  supersedeOrder: ownedOrder,
};

async function renderContent(query: Record<string, string | string[]>) {
  enabled = true;
  const page = await UnlimitedPassPage({
    searchParams: Promise.resolve(query),
  });
  const content = page.props.children;
  return content.type(content.props);
}

test("a renewal preselects the holder's prior configuration and authoritative exclusive end", async () => {
  const content = await renderContent({ renew: renewalSource });
  expect(content.props.children.props).toMatchObject({
    renewsPassId: renewalSource,
    initialOptions: renewalSelection,
    initialStartDate: renewalSelection.startDate,
  });
  const details = await renderContent({
    renew: renewalSource,
    step: "details",
    tier: "reserved-desk",
    startDate: "2026-12-21",
  });
  expect(details.props.children.props.initialDetails).toEqual({
    tier: "reserved-desk",
    startDate: renewalSelection.startDate,
  });
});

test("a renewal rejects invalid, repeated, or ineligible source IDs", async () => {
  for (const renew of [
    "invalid",
    [renewalSource, renewalSource],
    crypto.randomUUID(),
  ]) {
    await expect(renderContent({ renew })).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
  }
});

test("a bare renewal link returns through sign-in with its source ID", async () => {
  buyerSignedIn = false;
  await expect(renderContent({ renew: renewalSource })).rejects.toHaveProperty(
    "digest",
    expect.stringContaining(
      encodeURIComponent(`/cs-CZ/passes/unlimited?renew=${renewalSource}`)
    )
  );
});

test("a bare renewal link resumes the existing draft, which retains its source without the query", async () => {
  pendingRenewal = true;
  submittedOrderCommitted = true;
  await expect(renderContent({ renew: renewalSource })).rejects.toHaveProperty(
    "digest",
    expect.stringContaining(`order=${submittedOrder}`)
  );
  const content = await renderContent({
    order: submittedOrder,
    step: "details",
  });
  expect(content.props.children.props.renewsPassId).toBe(renewalSource);
  await expect(
    renderContent({
      order: submittedOrder,
      step: "details",
      renew: ownedOrder,
    })
  ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
});

test("reload restores an owned submitted draft to Details using the committed selection and holder", async () => {
  submittedOrderCommitted = true;
  const content = await renderContent({
    ...selectionQuery,
    submittedOrder,
    predecessorOrder: ownedOrder,
  });
  expect(content.props.children.props).toMatchObject({
    draft: {
      kind: "submitted",
      orderId: submittedOrder,
      holderEmail,
      predecessorOrderIds: [ownedOrder],
    },
    initialDetails: { tier: "reserved-desk", startDate: "2026-12-01" },
    retryPayment: undefined,
  });
});

test("reload before commit retains submitted and predecessor IDs without restoring another draft's holder", async () => {
  const unresolvedOrder = crypto.randomUUID();
  const content = await renderContent({
    ...selectionQuery,
    predecessorOrder: [unresolvedOrder, ownedOrder, unresolvedOrder],
    submittedOrder,
  });
  const props = content.props.children.props;
  expect(props).toMatchObject({
    draft: {
      kind: "submitted",
      orderId: submittedOrder,
      predecessorOrderIds: [unresolvedOrder, ownedOrder],
    },
    initialDetails: {
      tier: "open-space",
      startDate: "2026-12-15",
      coffee: true,
    },
    retryPayment: undefined,
  });
  expect(props.draft).not.toHaveProperty("holderEmail");
});

test("reload distinguishes an owned self-purchase from a submission that has not committed", async () => {
  submittedOrderCommitted = true;
  submittedGift = false;
  const content = await renderContent({ ...selectionQuery, submittedOrder });
  expect(content.props.children.props.draft).toMatchObject({
    kind: "submitted",
    orderId: submittedOrder,
    holderEmail: null,
  });
});

test("an order committed after the reload's owner read stays on Details", async () => {
  commitAfterContinuationRead = true;
  const content = await renderContent({ ...selectionQuery, submittedOrder });
  expect(submittedOrderCommitted).toBe(true);
  expect(content.props.children.props).toMatchObject({
    draft: { kind: "submitted", orderId: submittedOrder },
    initialDetails: {
      tier: "open-space",
      startDate: "2026-12-15",
      coffee: true,
    },
    retryPayment: undefined,
  });
});

test("an owned status-only submission continues to its issued status page", async () => {
  submittedOrderCommitted = true;
  submittedStatusOnly = true;
  await expect(
    renderContent({ ...selectionQuery, submittedOrder })
  ).rejects.toHaveProperty(
    "digest",
    `NEXT_REDIRECT;replace;/en-US/reservation/status/${submittedOrder};307;`
  );
});

test("an owned replacement survives reload with the edited selection", async () => {
  const content = await renderContent(editedSelectionQuery);
  expect(content.props.children.props).toMatchObject({
    draft: { kind: "replace", orderId: ownedOrder },
    initialDetails: {
      tier: "open-space",
      startDate: "2026-12-15",
      coffee: true,
    },
  });
});

test("sign-in continues to the same edited selection and checks predecessor ownership", async () => {
  buyerSignedIn = false;
  try {
    await expect(renderContent(editedSelectionQuery)).rejects.toHaveProperty(
      "digest",
      expect.stringContaining(
        `startDate%3D2026-12-15%26supersedeOrder%3D${ownedOrder}`
      )
    );
  } finally {
    buyerSignedIn = true;
  }
  await expect(
    renderContent({
      ...editedSelectionQuery,
      supersedeOrder: crypto.randomUUID(),
    })
  ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
});
