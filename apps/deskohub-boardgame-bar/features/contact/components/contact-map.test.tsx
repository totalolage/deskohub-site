import { describe, expect, test } from "bun:test";
import type { ElementType, ReactElement } from "react";
import { getLocale, m } from "@/features/i18n";
import { Card } from "@/shared/components/ui/card";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { siteConstants } from "@/shared/utils/constants";
import {
  getLocalizedCountryName,
  getTranslatedCityName,
} from "@/shared/utils/geo-formatting";
import { ContactMap } from "./contact-map";

setBoardgameTestEnv();

type MapElement = ReactElement<{ locale: string; address: string }>;

const bareMap = ContactMap({ showTitle: false, showCard: false }) as MapElement;
const mapType = bareMap.type as ElementType;

const layoutOf = (props?: Parameters<typeof ContactMap>[0]) => {
  const tree = ContactMap(props) as ReactElement<{
    id?: string;
    className?: string;
  }>;
  return {
    section: tree.props.id,
    className: tree.props.className,
    titles: findElementsOfType(tree, "h2").map(({ props }) => props.children),
    cards: findElementsOfType(tree, Card).length,
    maps: findElementsOfType(tree, mapType).length,
  };
};

describe("ContactMap", () => {
  test("renders only the map without a title or card", () => {
    const { address } = siteConstants.contact;
    const locale = getLocale();

    expect(bareMap.props.locale).toBe(locale);
    expect(bareMap.props.address).toStartWith(
      `${address.street}, ${address.postalCode} `
    );
    expect(bareMap.props.address).toContain(
      getTranslatedCityName(address.city, locale)
    );
    expect(bareMap.props.address).toEndWith(
      `, ${getLocalizedCountryName(address.countryCode, locale)}`
    );
  });

  test("shows the titled map section in a card by default", () => {
    expect(layoutOf()).toEqual({
      section: "map-section",
      className: "mt-16",
      titles: [m["contact.mapTitle"]()],
      cards: 1,
      maps: 1,
    });
  });

  test("leaves out the title and its spacing", () => {
    expect(layoutOf({ showTitle: false })).toEqual({
      section: "map-section",
      className: "",
      titles: [],
      cards: 1,
      maps: 1,
    });
  });

  test("leaves out the card around the titled map", () => {
    expect(layoutOf({ showCard: false })).toEqual({
      section: "map-section",
      className: "mt-16",
      titles: [m["contact.mapTitle"]()],
      cards: 0,
      maps: 1,
    });
  });
});
