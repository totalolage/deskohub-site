import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/features/i18n";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import type { ListedBoardGame } from "./BoardGameCard";
import { BoardGamesList } from "./BoardGamesList";

setBoardgameTestEnv();

const listedGame = (id: number, inStock: boolean): ListedBoardGame => ({
  id,
  bggId: 1000 + id,
  name: `Game ${id}`,
  imageUrl: `https://images.example.test/${id}.png`,
  inStock,
});

const listMarkup = (games: ReadonlyArray<ListedBoardGame>) =>
  renderToStaticMarkup(<BoardGamesList games={games} />);

const gameLinks = (markup: string) =>
  [
    ...markup.matchAll(
      /href="https:\/\/boardgamegeek\.com\/boardgame\/(\d+)"/g
    ),
  ].map(([, bggId]) => Number(bggId));

const playerButtons = (markup: string) =>
  [
    ...markup.matchAll(
      /<button aria-label="([^"]*)" aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g
    ),
  ].map(([, label, pressed, text]) => ({ label, pressed, text }));

describe("BoardGamesList", () => {
  test("lists a card for each in-stock game in order", () => {
    const markup = listMarkup([
      listedGame(1, true),
      listedGame(2, false),
      listedGame(3, true),
    ]);

    expect(gameLinks(markup)).toEqual([1001, 1003]);
    expect(markup).toContain(m["boardGames.filters.foundGames"]({ count: 2 }));
  });

  test("offers unpressed player counts from one to seven or more", () => {
    expect(playerButtons(listMarkup([listedGame(1, true)]))).toEqual([
      ...[1, 2, 3, 4, 5, 6].map((count) => ({
        label: m["boardGames.playerCount"]({ count }),
        pressed: "false",
        text: String(count),
      })),
      {
        label: m["boardGames.filters.sevenOrMorePlayers"](),
        pressed: "false",
        text: "7+",
      },
    ]);
  });

  test("shows the empty state instead of cards when no game is available", () => {
    const markup = listMarkup([listedGame(1, false)]);

    expect(gameLinks(markup)).toEqual([]);
    expect(markup).toContain(m["boardGames.filters.foundGames"]({ count: 0 }));
    expect(markup).toContain(m["boardGames.empty.title"]());
  });
});
