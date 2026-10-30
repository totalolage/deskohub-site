import { describe, expect, test } from "bun:test";
import { locales } from "@/features/i18n";
import { isPublicPagePathname } from "@/features/public-pages/public-pages";
import {
  faqAnswerLinkPaths,
  getFaqGroups,
  getFaqQuestions,
} from "./faq-entries";

const facts = {
  occupancy: { averageReservationsPerDay: 1.2, coworkSeatCapacity: 28 },
  officesOffered: false,
};

describe.each(locales)("getFaqGroups in %s", (locale) => {
  const groups = getFaqGroups(locale, facts);
  const entries = groups.flatMap((group) => group.entries);

  test("groups between 15 and 25 questions under unique topics", () => {
    expect(groups.length).toBeGreaterThan(1);
    expect(new Set(groups.map(({ value }) => value)).size).toBe(groups.length);
    for (const group of groups) expect(group.entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThanOrEqual(15);
    expect(entries.length).toBeLessThanOrEqual(25);
    expect(new Set(entries.map(({ value }) => value)).size).toBe(
      entries.length
    );
  });

  test("links answers only through known tags", () => {
    const tags = entries.flatMap(({ answer }) =>
      [...answer.matchAll(/<(\w+)>.*?<\/\1>/g)].map(([, tag]) => tag)
    );

    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags)
      expect(Object.keys(faqAnswerLinkPaths)).toContain(tag);
    expect(
      entries.some(({ answer }) =>
        /[<>]/.test(answer.replace(/<(\w+)>.*?<\/\1>/g, ""))
      )
    ).toBe(false);
  });

  test("previews only questions the page answers", () => {
    const questions = entries.map(({ question }) => question);

    for (const question of getFaqQuestions(locale)) {
      expect(questions).toContain(question);
    }
  });

  test("drops the private office question once offices can be booked", () => {
    const withOffices = getFaqGroups(locale, { ...facts, officesOffered: true })
      .flatMap((group) => group.entries)
      .map(({ value }) => value);

    expect(entries.map(({ value }) => value)).toContain("offices");
    expect(withOffices).not.toContain("offices");
  });

  test("leaves out the busyness question while last month's occupancy is unknown", () => {
    const withoutOccupancy = getFaqGroups(locale, {
      ...facts,
      occupancy: undefined,
    })
      .flatMap((group) => group.entries)
      .map(({ value }) => value);

    expect(entries.map(({ value }) => value)).toContain("busyness");
    expect(withoutOccupancy).not.toContain("busyness");
    expect(withoutOccupancy).toHaveLength(entries.length - 1);
  });
});

test("links answers to public pages", () => {
  for (const path of Object.values(faqAnswerLinkPaths)) {
    expect(isPublicPagePathname(path)).toBe(true);
  }
});
