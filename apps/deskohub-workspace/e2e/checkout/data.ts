import { Effect } from "effect";
import { submitCoworkReservationScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import {
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { assert, log } from "../runtime";
import type { CheckoutData, CheckoutFlow } from "../types";

let checkoutContactSequence = 0;

export const checkoutFlows: readonly CheckoutFlow[] = [
  {
    id: "cowork-basic",
    makeData: (config, _datasourceConfig, date) =>
      Effect.succeed(makeCoworkCheckoutData(config.baseUrl, date)),
    submitReservationScript: () => submitCoworkReservationScript,
  },
];

const makeCheckoutContact = (flowId: string) => {
  checkoutContactSequence += 1;
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const sequence = String(checkoutContactSequence % 100).padStart(2, "0");
  const emailKey = `${flowId}-${runId}-${sequence}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-");
  const name = `Workspace E2E ${flowId} ${runId} ${sequence}`;
  const phone = `+4207${runId.slice(2, 8)}${sequence}`;
  const email = `delivered+${emailKey}@resend.dev`;
  const message = `Automated checkout e2e ${flowId} ${runId} ${sequence}`;

  return { email, message, name, phone };
};

export const makeCoworkCheckoutData = (
  checkoutBaseUrl: string,
  date: string,
  flowId = "cowork-basic"
): CheckoutData => {
  const locale: CheckoutData["locale"] = "en-US";
  const contact = makeCheckoutContact(flowId);
  const params = new URLSearchParams({
    coffee: "false",
    date,
    email: contact.email,
    entryTier: "basic",
    message: contact.message,
    name: contact.name,
    phone: contact.phone,
  });

  return {
    checkoutUrl: `${checkoutBaseUrl}/${locale}/checkout/order?${params}`,
    date,
    email: contact.email,
    expectedCoffee: false,
    expectedMonitorOption: null,
    expectedProductTier: "basic",
    locale,
    message: contact.message,
    name: contact.name,
    orderIdHint: "",
    phone: contact.phone,
  };
};

export const requireCheckoutDate = (
  dates: readonly string[],
  index: number
): Effect.Effect<string, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("select checkout date", () => {
    const date = dates[index];
    assert(date, `missing checkout date ${index + 1}`);
    return date;
  });

export const selectAvailableCoworkDates = (
  config: WorkspaceE2EConfig,
  count: number
): Effect.Effect<readonly string[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    const from = futureIsoDate(14);
    const to = futureIsoDate(90);
    const params = new URLSearchParams({ entryTier: "basic", from, to });
    const response = yield* tryWorkspaceE2EPromise(
      "fetch workspace availability dates",
      () =>
        fetch(`${config.baseUrl}/api/workspace/availability?${params}`, {
          headers: config.bypassSecret
            ? { "x-vercel-protection-bypass": config.bypassSecret }
            : undefined,
        })
    );
    yield* tryWorkspaceE2ESync("assert availability response", () =>
      assert(response.ok, `availability check failed with ${response.status}`)
    );

    const availability = (yield* tryWorkspaceE2EPromise(
      "read workspace availability response",
      () => response.json()
    )) as {
      readonly unavailableDates?: unknown;
    };
    const unavailable = yield* tryWorkspaceE2ESync(
      "parse workspace availability dates",
      () => {
        assert(
          Array.isArray(availability.unavailableDates),
          "availability response missing unavailableDates"
        );
        return new Set(
          availability.unavailableDates.filter(
            (date): date is string => typeof date === "string"
          )
        );
      }
    );

    const dates: string[] = [];
    for (let offset = 14; offset <= 90; offset += 1) {
      const date = futureIsoDate(offset);
      if (!isWeekday(date) || unavailable.has(date)) continue;
      dates.push(date);
      if (dates.length === count) {
        log(`Selected available checkout dates ${dates.join(", ")}`);
        return dates;
      }
    }

    return yield* Effect.fail(
      workspaceE2EError(
        `Only found ${dates.length} available checkout dates, need ${count}`,
        { operation: "select available cowork checkout dates" }
      )
    );
  });

const futureIsoDate = (offsetDays: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const isWeekday = (date: string) => {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
};
