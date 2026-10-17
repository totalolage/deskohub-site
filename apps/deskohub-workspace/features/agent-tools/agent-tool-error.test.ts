import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { AgentToolError, getAgentToolErrorMessage } from "./agent-tool-error";

const errors = [
  AgentToolError.invalidInput(),
  AgentToolError.invalidInput("seats"),
  AgentToolError.dateOutOfRange({
    earliest: "2099-06-10",
    latest: "2099-07-10",
  }),
  AgentToolError.unsupportedFamily(),
  AgentToolError.rateLimited(),
  AgentToolError.unavailable("availability_unavailable")(null),
  AgentToolError.unavailable("quote_unavailable")(null),
  AgentToolError.unavailable("offerings_unavailable")(null),
];

describe("getAgentToolErrorMessage", () => {
  test("explains every error code in English", () => {
    expect(
      errors.map((error) => getAgentToolErrorMessage(error.details, "en-US"))
    ).toEqual([
      "The request is missing a required value or contains an invalid one.",
      "The seats value is missing or invalid.",
      "Choose a date from 2099-06-10 to 2099-07-10.",
      "This reservation family can't be booked right now.",
      "Too many requests. Wait a minute and try again.",
      "Availability can't be checked right now. Try again shortly or check the website.",
      "A price can't be quoted right now. Try again shortly or check the website.",
      "The offerings can't be listed right now. Try again shortly.",
    ]);
  });

  test("explains every error code in Czech", () => {
    expect(
      errors.map((error) => getAgentToolErrorMessage(error.details, "cs-CZ"))
    ).toEqual([
      "V požadavku chybí povinná hodnota nebo je některá hodnota neplatná.",
      "Hodnota seats chybí nebo je neplatná.",
      "Vyber datum od 2099-06-10 do 2099-07-10.",
      "Tento typ rezervace teď nejde rezervovat.",
      "Příliš mnoho požadavků. Počkej minutu a zkus to znovu.",
      "Dostupnost teď nejde ověřit. Zkus to za chvíli znovu nebo se podívej na web.",
      "Cenu teď nejde spočítat. Zkus to za chvíli znovu nebo se podívej na web.",
      "Nabídku teď nejde načíst. Zkus to za chvíli znovu.",
    ]);
  });
});
