import { describe, expect, test } from "bun:test";
import { resolveCustomerAgentConsentOutcome } from "./customer-agent-consent-outcome";

const client = { name: "Agent" };
const customerRequest = {
  administration: false,
  scopes: ["reservations:read", "offline_access"],
} as const;
const administrationOnlyRequest = {
  administration: true,
  scopes: ["offline_access"],
} as const;

describe("resolveCustomerAgentConsentOutcome", () => {
  test("asks the customer about a found client", () => {
    expect(
      resolveCustomerAgentConsentOutcome({
        request: customerRequest,
        client,
        administrator: false,
      })
    ).toEqual({ client, administration: false });
  });

  test("offers administration to an administrator", () => {
    expect(
      resolveCustomerAgentConsentOutcome({
        request: administrationOnlyRequest,
        client,
        administrator: true,
      })
    ).toEqual({ client, administration: true });
  });

  test("stops when the administrator grant can't be read", () => {
    expect(
      resolveCustomerAgentConsentOutcome({
        request: customerRequest,
        client,
        administrator: "unavailable",
      })
    ).toEqual({ notice: "unavailable" });
  });

  test("stops a request left with nothing once administration is dropped", () => {
    expect(
      resolveCustomerAgentConsentOutcome({
        request: administrationOnlyRequest,
        client,
        administrator: false,
      })
    ).toEqual({ notice: "administration-only" });
  });

  test("drops administration but keeps customer scopes for a non-administrator", () => {
    expect(
      resolveCustomerAgentConsentOutcome({
        request: { ...customerRequest, administration: true },
        client,
        administrator: false,
      })
    ).toEqual({ client, administration: false });
  });

  test("names an unknown client as an unknown request", () => {
    expect(
      resolveCustomerAgentConsentOutcome({
        request: customerRequest,
        client: undefined,
        administrator: false,
      })
    ).toEqual({ notice: "unknown-request" });
  });

  test("reports a client that couldn't be read as unavailable", () => {
    expect(
      resolveCustomerAgentConsentOutcome({
        request: customerRequest,
        client: "unavailable",
        administrator: false,
      })
    ).toEqual({ notice: "unavailable" });
  });
});
