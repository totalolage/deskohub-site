import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { FaqPage } from "./faq-page";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("FAQ focus indicator has at least 3:1 contrast against its navy offset", async () => {
  const view = render(
    <FaqPage
      averageReservationsPerDay={1.2}
      coworkSeatCapacity={28}
      locale="en-US"
    />
  );
  const summary = view.container.querySelector("summary");
  expect(summary).toBeTruthy();

  const classes = summary?.className.split(/\s+/) ?? [];
  const focusRingColorClass = classes.find(
    (className) =>
      className.startsWith("focus-visible:ring-") &&
      className !== "focus-visible:ring-2" &&
      !className.startsWith("focus-visible:ring-offset-")
  );
  if (!focusRingColorClass) {
    throw new Error("FAQ summary is missing its focus ring color class.");
  }

  const focusRingToken = focusRingColorClass.slice(
    "focus-visible:ring-".length
  );
  const ringOffsetColor = summary?.className.match(
    /focus-visible:ring-offset-\[(#[\da-f]{6})\]/i
  )?.[1];
  if (!ringOffsetColor) {
    throw new Error("FAQ summary is missing its explicit navy ring offset.");
  }

  const styles = await readFile(
    join(import.meta.dir, "../../../shared/styles/brand-theme.css"),
    "utf8"
  );
  expect(styles).toContain(
    `--color-${focusRingToken}: var(--brand-${focusRingToken});`
  );
  const focusRingColor = styles.match(
    new RegExp(`--brand-${focusRingToken}:\\s*(#[\\da-f]{6})\\s*;`, "i")
  )?.[1];
  if (!focusRingColor) {
    throw new Error(`FAQ focus ring token ${focusRingToken} has no hex color.`);
  }

  expect(
    colorContrastRatio(focusRingColor, ringOffsetColor)
  ).toBeGreaterThanOrEqual(3);
});

test("localizes Czech copy and formats the average with one decimal", () => {
  const view = render(
    <FaqPage
      averageReservationsPerDay={1}
      coworkSeatCapacity={28}
      locale="cs-CZ"
    />
  );

  expect(
    view.getByRole("heading", {
      level: 1,
      name: m.faqPageTitle({}, { locale: "cs-CZ" }),
    })
  ).toBeTruthy();
  const busyness = view
    .getByRole("heading", {
      level: 2,
      name: m.faqQuestionBusyness({}, { locale: "cs-CZ" }),
    })
    .closest("details") as HTMLDetailsElement;
  fireEvent.click(busyness.querySelector("summary")!);
  expect(busyness.open).toBe(true);
  expect(
    view.getByText(
      m.faqAnswerBusyness(
        { average: "1,0", capacity: "28" },
        { locale: "cs-CZ" }
      )
    )
  ).toBeTruthy();
});

function colorContrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string) {
  const [red, green, blue] = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );

  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
