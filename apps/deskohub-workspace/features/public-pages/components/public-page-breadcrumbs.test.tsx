import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { PublicPageBreadcrumbs } from "./public-page-breadcrumbs";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

type BreadcrumbListItemData = {
  readonly "@type": string;
  readonly position: number;
  readonly item: string;
};

const renderTrail = () =>
  render(
    <PublicPageBreadcrumbs
      crumbs={[
        { pathname: "/coworking", name: "Coworking" },
        { pathname: "/reservation/cowork", name: "Rezervace" },
      ]}
      locale="cs-CZ"
    />
  );

test("links every page above the current one and marks the current page", () => {
  const view = renderTrail();
  const items = [...view.container.querySelectorAll("nav ol > li")];

  expect(items).toHaveLength(3);
  expect(
    items
      .slice(0, -1)
      .map((item) => item.querySelector("a")?.getAttribute("href"))
  ).toEqual(["/cs-CZ", "/cs-CZ/coworking"]);
  const current = items.at(-1);
  expect(current?.querySelector("a")).toBeNull();
  expect(current?.querySelector('[aria-current="page"]')?.textContent).toBe(
    "Rezervace"
  );
});

test("describes the same trail as a BreadcrumbList on the exact locale pages", () => {
  const view = renderTrail();
  const data = JSON.parse(
    view.container.querySelector('script[type="application/ld+json"]')
      ?.textContent ?? "{}"
  );

  expect(data).toMatchObject({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
  });
  expect(
    data.itemListElement.map(
      ({ "@type": type, position, item }: BreadcrumbListItemData) => ({
        type,
        position,
        item,
      })
    )
  ).toEqual([
    {
      type: "ListItem",
      position: 1,
      item: "https://workspace.deskohub.cz/cs-CZ",
    },
    {
      type: "ListItem",
      position: 2,
      item: "https://workspace.deskohub.cz/cs-CZ/coworking",
    },
    {
      type: "ListItem",
      position: 3,
      item: "https://workspace.deskohub.cz/cs-CZ/reservation/cowork",
    },
  ]);
  expect(data.itemListElement.at(-1).name).toBe("Rezervace");
});
