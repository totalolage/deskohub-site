import { describe, expect, test } from "bun:test";
import { filterBoardGames } from "./filter-board-games";

const games = [
  { name: "Quick game", minPlayers: 2, maxPlayers: 4, playingTimeMinutes: 30 },
  { name: "Long game", minPlayers: 4, maxPlayers: 8, playingTimeMinutes: 150 },
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
});
