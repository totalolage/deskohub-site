import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type {
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
  messagePlainText,
} from "@/shared/markdown/markdown.test-utils";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import { getFaqGroups } from "./faq-entries";

const coworkTableId = "synthetic-cowork-table";

const coworkTable: DotyposTable = {
  _cloudId: "synthetic-cloud",
  id: coworkTableId,
  name: "Synthetic cowork table",
  seats: "4",
  tags: ["cowork:basic"],
};

// 17 reservations over April's 30 days average 0.6 a day.
const aprilReservations = Array.from(
  { length: 17 },
  (_, index): DotyposReservation => ({
    _branchId: "synthetic-branch",
    _cloudId: "synthetic-cloud",
    _tableId: coworkTableId,
    endDate: "2026-04-15T09:00:00Z",
    id: `synthetic-april-${index}`,
    seats: "1",
    startDate: "2026-04-15T08:00:00Z",
    status: "CONFIRMED",
  })
);

mock.module("next/cache", () => recordNextCache().module);
mock.module("@/shared/backend/config/dotypos.config", () => ({
  WorkspaceDotyposLayer: Layer.succeed(DotyposService, {
    getTables: () => Effect.succeed([coworkTable]),
    listReservations: () => Effect.succeed(aprilReservations),
  }),
}));

const { faqPageMarkdown } = await import("./faq-page-markdown");

beforeAll(() => setSystemTime(new Date("2026-05-15T12:00:00Z")));
afterAll(() => setSystemTime());

const formattedOccupancy = {
  "en-US": { average: "0.6", capacity: "4" },
  "cs-CZ": { average: "0,6", capacity: "4" },
} as const;

const renderMarkdown = async (
  locale: (typeof locales)[number],
  officePublished = false
) =>
  serializeMarkdown(
    await Effect.runPromise(
      faqPageMarkdown(locale, {
        isPublished: (pathname) =>
          officePublished || pathname !== "/reservation/office",
      })
    )
  );

// Left out on purpose: the metadata title and description, which the page
// sends as metadata.
describe.each(locales)("faqPageMarkdown in %s", (locale) => {
  test("shows every topic with its questions and answers, the busyness from last month's reservations", async () => {
    const markdown = await renderMarkdown(locale);
    const groups = getFaqGroups(locale, {
      occupancy: { averageReservationsPerDay: 0.6, coworkSeatCapacity: 4 },
      officesOffered: false,
    });

    expect(markdownPlainText(markdown)).toBe(
      [
        m.faqPageTitle({}, { locale }),
        ...groups.flatMap((group) => [
          group.title,
          ...group.entries.flatMap((entry) => [
            entry.question,
            // Plain text collapses the no-break spaces in formatted prices.
            messagePlainText(entry.answer).replace(/\s+/g, " "),
          ]),
        ]),
      ].join("\n")
    );
    expect(markdown).toStartWith(`# ${m.faqPageTitle({}, { locale })}`);
    expect(markdown).toContain(`\n## ${groups[0]?.title}\n`);
    expect(markdown).toContain(
      `\n### ${m.faqQuestionBusyness({}, { locale })}\n`
    );
    expect(markdown).toContain(
      m.faqAnswerBusyness(formattedOccupancy[locale], { locale })
    );
  });

  test("links answers to locale-agnostic site pages", async () => {
    const urls = markdownLinkUrls(await renderMarkdown(locale));

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toStartWith("https://workspace.deskohub.cz/");
      expect(new URL(url).pathname).not.toMatch(/^\/(en-US|cs-CZ)(\/|$)/);
    }
  });

  test("says private offices aren't offered only while the office page is unpublished", async () => {
    const question = m.faqQuestionOffices({}, { locale });

    expect(markdownPlainText(await renderMarkdown(locale))).toContain(question);
    expect(markdownPlainText(await renderMarkdown(locale, true))).not.toContain(
      question
    );
  });
});
