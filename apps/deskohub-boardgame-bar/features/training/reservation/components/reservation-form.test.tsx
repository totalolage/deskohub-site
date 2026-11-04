import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { format } from "date-fns";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderOnLocaleRoute } from "@/features/gallery/components/gallery-render.test-utils";
import { m } from "@/features/i18n";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { workspaceConstants } from "../schemas/reservation";

setBoardgameTestEnv();
mock.module("server-only", () => ({}));

let ReservationForm: typeof import("./reservation-form").ReservationForm;

beforeAll(async () => {
  ({ ReservationForm } = await import("./reservation-form"));
});

const initialDefaults = { ...workspaceConstants.defaultValues };

afterEach(() => {
  Object.assign(workspaceConstants.defaultValues, initialDefaults);
});

const router: AppRouterInstance = {
  bfcacheId: "test",
  back: () => {},
  forward: () => {},
  prefetch: () => {},
  push: () => {},
  refresh: () => {},
  replace: () => {},
};

const renderForm = () =>
  renderOnLocaleRoute(
    <AppRouterContext.Provider value={router}>
      <ReservationForm />
    </AppRouterContext.Provider>
  );

const escaped = (text: string) => Bun.escapeHTML(text);

const dateButton = (html: string) => {
  const [, attributes = "", content = ""] =
    html.match(/<button([^>]*id="date-button"[^>]*)>(.*?)<\/button>/) ?? [];
  return {
    classes: /class="([^"]*)"/.exec(attributes)?.[1]?.split(" "),
    content,
  };
};

const requirementsCount = (html: string) =>
  html.match(/<span id="special-requirements-count"[^>]*>(.*?)<\/span>/)?.[1];

const maxRequirements = workspaceConstants.validation.specialRequirements.max;

describe("ReservationForm", () => {
  test("prompts for a date and counts no special requirements on an empty form", () => {
    const html = renderForm();
    const button = dateButton(html);

    expect(button.content).toContain(
      escaped(m["trainingReservation.form.pickDate"]())
    );
    expect(button.classes).toContain("text-muted-foreground");
    expect(requirementsCount(html)).toBe(`0/${maxRequirements}`);
    expect(html).toContain(escaped(m["trainingReservation.form.submit"]()));
  });

  test("shows the chosen date and the special requirements' length", () => {
    const date = new Date(2026, 11, 1);
    Object.assign(workspaceConstants.defaultValues, {
      date,
      specialRequirements: "Projector",
    });

    const html = renderForm();
    const button = dateButton(html);

    expect(button.content).toContain(escaped(format(date, "PPP")));
    expect(button.content).not.toContain(
      escaped(m["trainingReservation.form.pickDate"]())
    );
    expect(button.classes).not.toContain("text-muted-foreground");
    expect(requirementsCount(html)).toBe(`9/${maxRequirements}`);
  });
});
