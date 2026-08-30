import { describe, expect, test } from "bun:test";
import { filterBoardGames } from "./filter-board-games";

const games = [
  {
    name: "Quick game",
    minPlayers: 2,
    maxPlayers: 4,
    playingTimeMinutes: 30,
    inStock: true,
  },
  {
    name: "Long game",
    minPlayers: 4,
    maxPlayers: 8,
    playingTimeMinutes: 150,
    inStock: true,
  },
  {
    name: "Long unavailable game",
    minPlayers: 4,
    maxPlayers: 8,
    playingTimeMinutes: 150,
    inStock: false,
  },
  {
    name: "Game with incomplete metadata",
    minPlayers: null,
    maxPlayers: null,
    playingTimeMinutes: null,
    inStock: true,
  },
];

describe("filterBoardGames", () => {
  test("combines search, player, and duration filters", () => {
    expect(
      filterBoardGames(games, {
        playerCount: 7,
        durations: ["over120"],
        search: " LONG ",
      })
    ).toEqual([games[1]!]);
  });

  test("keeps games with incomplete metadata until a matching filter is active", () => {
    expect(
      filterBoardGames(games, {
        playerCount: null,
        durations: [],
        search: "",
      })
    ).toEqual([games[0]!, games[1]!, games[3]!]);

    expect(
      filterBoardGames(games, {
        playerCount: 2,
        durations: [],
        search: "",
      })
    ).toEqual([games[0]!]);

    expect(
      filterBoardGames(games, {
        playerCount: null,
        durations: ["upTo30"],
        search: "",
      })
    ).toEqual([games[0]!]);
  });
});
