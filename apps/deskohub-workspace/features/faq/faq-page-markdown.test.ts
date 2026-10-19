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
} from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

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

mock.module("next/cache", () => ({ cacheLife: () => undefined }));
mock.module("@/shared/backend/config/dotypos.config", () => ({
  WorkspaceDotyposLayer: Layer.succeed(DotyposService, {
    getTables: () => Effect.succeed([coworkTable]),
    listReservations: () => Effect.succeed(aprilReservations),
  }),
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string, _options?: { readonly boundary?: string }) =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
}));

const { faqPageMarkdown } = await import("./faq-page-markdown");

beforeAll(() => setSystemTime(new Date("2026-05-15T12:00:00Z")));
afterAll(() => setSystemTime());

const formattedOccupancy = {
  "en-US": { average: "0.6", capacity: "4" },
  "cs-CZ": { average: "0,6", capacity: "4" },
} as const;

// Left out on purpose: the metadata title and description, which the page
// sends as metadata.
describe.each(locales)("faqPageMarkdown in %s", (locale) => {
  test("shows every question with its answer, the busyness from last month's reservations", async () => {
    const { address } = workspaceSiteConstants.location;
    const markdown = serializeMarkdown(
      await Effect.runPromise(faqPageMarkdown(locale))
    );

    expect(markdownPlainText(markdown)).toBe(
      [
        m.faqPageTitle({}, { locale }),
        m.faqQuestionLocation({}, { locale }),
        `${address.street}, ${address.cityDistrict}, ${address.city} ${address.postalCode}`,
        m.faqQuestionHowItWorks({}, { locale }),
        m.faqAnswerHowItWorks({}, { locale }),
        m.faqQuestionInternet({}, { locale }),
        m.faqAnswerInternet({}, { locale }),
        m.faqQuestionFood({}, { locale }),
        m.faqAnswerFood({}, { locale }),
        m.faqQuestionCalls({}, { locale }),
        m.faqAnswerCalls({}, { locale }),
        m.faqQuestionBusyness({}, { locale }),
        m.faqAnswerBusyness(formattedOccupancy[locale], { locale }),
      ].join("\n")
    );
    expect(markdown).toStartWith(`# ${m.faqPageTitle({}, { locale })}`);
    expect(markdown).toContain(
      `\n## ${m.faqQuestionBusyness({}, { locale })}\n`
    );
    expect(markdownLinkUrls(markdown)).toEqual([]);
  });
});
