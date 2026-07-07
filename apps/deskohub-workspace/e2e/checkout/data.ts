import { submitCoworkReservationScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import { assert, log } from "../runtime";
import type { CheckoutData, CheckoutFlow } from "../types";

let checkoutContactSequence = 0;

export const checkoutFlows: readonly CheckoutFlow[] = [
  {
    id: "cowork-basic",
    makeData: async (config, _datasourceConfig, date) =>
      makeCoworkCheckoutData(config.browserUrl, date),
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
  const name = `Workspace E2E ${flowId} ${runId} ${sequence}`;
  const phone = `+420735${runId.slice(6, 10)}${sequence}`;
  const email = "delivered@resend.dev";
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
) => {
  const date = dates[index];
  assert(date, `missing checkout date ${index + 1}`);
  return date;
};

export const selectAvailableCoworkDates = async (
  config: WorkspaceE2EConfig,
  count: number
) => {
  const from = futureIsoDate(14);
  const to = futureIsoDate(90);
  const params = new URLSearchParams({ entryTier: "basic", from, to });
  const response = await fetch(
    `${config.browserUrl}/api/workspace/availability?${params}`,
    {
      headers: config.bypassSecret
        ? { "x-vercel-protection-bypass": config.bypassSecret }
        : undefined,
    }
  );
  assert(response.ok, `availability check failed with ${response.status}`);

  const availability = (await response.json()) as {
    readonly unavailableDates?: unknown;
  };
  assert(
    Array.isArray(availability.unavailableDates),
    "availability response missing unavailableDates"
  );
  const unavailable = new Set(
    availability.unavailableDates.filter(
      (date): date is string => typeof date === "string"
    )
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

  throw new Error(
    `Only found ${dates.length} available checkout dates, need ${count}`
  );
};

const futureIsoDate = (offsetDays: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const isWeekday = (date: string) => {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
};
