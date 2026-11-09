import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import placeholderImage from "@/assets/images/placeholder/placeholder.svg";
import { m } from "@/features/i18n";
import { ImageWithFallback } from "@/shared/components/ui/image-with-fallback";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import {
  BoardGameCard,
  boardGamePlayers,
  type ListedBoardGame,
} from "./BoardGameCard";

setBoardgameTestEnv();

const listedGame = (
  game: Omit<Partial<ListedBoardGame>, "id" | "bggId">
): ListedBoardGame => ({
  id: 1,
  bggId: 1234,
  name: "Listed game",
  imageUrl: "https://images.example.test/game.png",
  inStock: true,
  ...game,
});

const cardMarkup = (game: ListedBoardGame) =>
  renderToStaticMarkup(<BoardGameCard game={game} />);

const factsRowCount = (markup: string) =>
  markup.match(/<div class="flex flex-wrap items-center gap-3\.5/g)?.length ??
  0;

describe("boardGamePlayers", () => {
  test("is unknown without both player bounds", () => {
    expect(boardGamePlayers({ minPlayers: 2, maxPlayers: null })).toBeNull();
    expect(boardGamePlayers({ maxPlayers: 4 })).toBeNull();
  });

  test("names a single count when the bounds match", () => {
    expect(boardGamePlayers({ minPlayers: 2, maxPlayers: 2 })).toBe(
      m["boardGames.playerCount"]({ count: 2 })
    );
  });

  test("names the range when the bounds differ", () => {
    expect(boardGamePlayers({ minPlayers: 2, maxPlayers: 5 })).toBe(
      m["boardGames.playerRange"]({ min: 2, max: 5 })
    );
  });
});

describe("BoardGameCard", () => {
  test("links to the game's BoardGameGeek page in a new tab", () => {
    const card = BoardGameCard({ game: listedGame({}) });

    expect(card.type).toBe("a");
    expect(card.props).toMatchObject({
      href: "https://boardgamegeek.com/boardgame/1234",
      rel: "noopener noreferrer",
      target: "_blank",
    });
  });

  test("shows the game image and falls back to the placeholder without one", () => {
    const imageSource = (game: ListedBoardGame) =>
      findElementsOfType(BoardGameCard({ game }), ImageWithFallback).map(
        ({ props }) => ({ src: props.src, fallbackSrc: props.fallbackSrc })
      );

    expect(imageSource(listedGame({}))).toEqual([
      {
        src: "https://images.example.test/game.png",
        fallbackSrc: placeholderImage.src,
      },
    ]);
    expect(imageSource(listedGame({ imageUrl: null }))).toEqual([
      { src: placeholderImage.src, fallbackSrc: placeholderImage.src },
    ]);
  });

  test("shows the rating to one decimal place only when rated", () => {
    const ratings = (game: ListedBoardGame) =>
      findElementsOfType(BoardGameCard({ game }), "span").map(
        ({ props }) => props.children
      );

    expect(ratings(listedGame({ rating: 7.456 }))).toEqual(["7.5"]);
    expect(ratings(listedGame({ rating: 0 }))).toEqual(["0.0"]);
    expect(ratings(listedGame({ rating: null }))).toEqual([]);
  });

  test("shows the description only when it has text", () => {
    const descriptions = (game: ListedBoardGame) =>
      findElementsOfType(BoardGameCard({ game }), "p").map(
        ({ props }) => props.children
      );

    expect(descriptions(listedGame({ description: "Co-op" }))).toEqual([
      "Co-op",
    ]);
    expect(descriptions(listedGame({ description: "" }))).toEqual([]);
    expect(descriptions(listedGame({ description: null }))).toEqual([]);
  });

  test("lists the language, player count, and playing time it knows", () => {
    const markup = cardMarkup(
      listedGame({
        language: "en",
        minPlayers: 2,
        maxPlayers: 4,
        playingTimeMinutes: 45,
      })
    );

    expect(factsRowCount(markup)).toBe(1);
    expect(markup).toContain(`>${m["boardGames.filters.english"]()}</`);
    expect(markup).toContain(
      `>${m["boardGames.playerRange"]({ min: 2, max: 4 })}</span>`
    );
    expect(markup).toContain(
      `<span>${m["boardGames.minutes"]({ count: 45 })}</span>`
    );
  });

  test("labels each language with its own badge style", () => {
    const badgeOf = (language: "any" | "cz" | "en") => {
      const markup = cardMarkup(listedGame({ language }));
      return markup
        .match(/<div[^>]*class="[^"]*rounded-md[^"]*"[^>]*>([^<]*)</)
        ?.slice(0, 2);
    };
    const labels = {
      any: m["boardGames.filters.languageIndependent"](),
      cz: m["boardGames.filters.czech"](),
      en: m["boardGames.filters.english"](),
    };

    const badges = (["any", "cz", "en"] as const).map((language) => {
      const badge = badgeOf(language);
      expect(badge?.[1]).toBe(labels[language]);
      return badge?.[0];
    });
    expect(new Set(badges).size).toBe(3);
  });

  test("shows each known fact on its own", () => {
    expect(factsRowCount(cardMarkup(listedGame({ language: "cz" })))).toBe(1);
    expect(
      factsRowCount(cardMarkup(listedGame({ minPlayers: 3, maxPlayers: 3 })))
    ).toBe(1);
    expect(
      factsRowCount(cardMarkup(listedGame({ playingTimeMinutes: 0 })))
    ).toBe(1);
  });

  test("omits the facts row when no fact is known", () => {
    expect(
      factsRowCount(
        cardMarkup(
          listedGame({ language: null, minPlayers: 3, maxPlayers: null })
        )
      )
    ).toBe(0);
  });
});
