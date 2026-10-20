import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AgentToolError,
  agentToolErrorResultSchema,
  getAgentToolErrorMessage,
  toAgentToolErrorResult,
} from "./agent-tool-error";

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
  AgentToolError.serviceUnavailable(),
  AgentToolError.refused("profile_incomplete")(),
  AgentToolError.refused("selection_unavailable")(),
  AgentToolError.refused("reservation_conflict")(),
  AgentToolError.refused("payment_in_progress")(),
  AgentToolError.refused("account_unavailable")(),
  AgentToolError.refused("reservation_not_found")(),
  AgentToolError.unavailable("reservation_unavailable")(null),
  AgentToolError.unavailable("reservations_unavailable")(null),
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
      "The tools are temporarily unavailable. Try again later or use the website.",
      "Finish your profile on the website first: add your name and phone number on your account page, then try again.",
      "This selection is no longer available. Check availability and choose another option.",
      "The booking couldn't be started because it is already being processed. Try again in a minute.",
      "The payment for this booking is still being processed, and its Pay link has expired. Check the booking status instead of starting it again.",
      "Your account can't make bookings right now. Sign in on the website to check it.",
      "No reservation with this order ID was found in your account.",
      "The booking can't be started right now. Try again shortly or book on the website.",
      "Your reservations can't be loaded right now. Try again shortly or check your account on the website.",
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
      "Nástroje jsou dočasně nedostupné. Zkus to později nebo použij web.",
      "Nejdřív dokonči profil na webu: na stránce účtu doplň jméno a telefon a pak to zkus znovu.",
      "Tento výběr už není volný. Ověř dostupnost a vyber jinou možnost.",
      "Rezervaci teď nejde začít, protože se už zpracovává. Zkus to za minutu znovu.",
      "Platba za tuto rezervaci se ještě zpracovává a odkaz na platbu už vypršel. Místo nového založení zkontroluj stav rezervace.",
      "Tvůj účet teď nemůže rezervovat. Přihlas se na webu a zkontroluj ho.",
      "Rezervace s tímto číslem objednávky ve tvém účtu není.",
      "Rezervaci teď nejde začít. Zkus to za chvíli znovu nebo si rezervuj na webu.",
      "Tvoje rezervace teď nejde načíst. Zkus to za chvíli znovu nebo se podívej do účtu na webu.",
    ]);
  });
});

describe("toAgentToolErrorResult", () => {
  test("matches the published error result schema for every code", () => {
    const isErrorResult = Schema.is(agentToolErrorResultSchema);

    for (const error of errors) {
      const result = toAgentToolErrorResult(error.details, "cs-CZ");

      expect(isErrorResult(result)).toBe(true);
      expect(result.error).toMatchObject(error.details);
      expect(result.error.message).toBe(
        getAgentToolErrorMessage(error.details, "cs-CZ")
      );
    }
  });
});
