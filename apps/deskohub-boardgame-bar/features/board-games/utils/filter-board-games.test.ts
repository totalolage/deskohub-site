import { describe, expect, test } from "bun:test";
import { filterBoardGames, toggleDurationFilter } from "./filter-board-games";

const games = [
  {
    name: "Quick game",
    minPlayers: 2,
    maxPlayers: 4,
    playingTimeMinutes: 30,
    inStock: true,
    language: "cz" as const,
  },
  {
    name: "Long game",
    minPlayers: 4,
    maxPlayers: 8,
    playingTimeMinutes: 150,
    inStock: true,
    language: "en" as const,
  },
  {
    name: "Long unavailable game",
    minPlayers: 4,
    maxPlayers: 8,
    playingTimeMinutes: 150,
    inStock: false,
    language: "any" as const,
  },
  {
    name: "Game with incomplete metadata",
    minPlayers: null,
    maxPlayers: null,
    playingTimeMinutes: null,
    inStock: true,
    language: null,
  },
  {
    name: "Game without optional metadata",
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
        language: "en",
      })
    ).toEqual([games[1]!]);
  });

  test("ands language with every active filter", () => {
    const languageGames = [
      {
        name: "English alternate",
        minPlayers: 2,
        maxPlayers: 6,
        playingTimeMinutes: 45,
        inStock: true,
        language: "en" as const,
      },
      {
        name: "English target too many players",
        minPlayers: 5,
        maxPlayers: 6,
        playingTimeMinutes: 45,
        inStock: true,
        language: "en" as const,
      },
      {
        name: "English target too long",
        minPlayers: 2,
        maxPlayers: 6,
        playingTimeMinutes: 120,
        inStock: true,
        language: "en" as const,
      },
      {
        name: "English target unavailable",
        minPlayers: 2,
        maxPlayers: 6,
        playingTimeMinutes: 45,
        inStock: false,
        language: "en" as const,
      },
      {
        name: "English target game",
        minPlayers: 2,
        maxPlayers: 6,
        playingTimeMinutes: 45,
        inStock: true,
        language: "en" as const,
      },
    ];

    expect(
      filterBoardGames(languageGames, {
        playerCount: 4,
        durations: ["upTo60"],
        search: "target",
        language: "en",
      })
    ).toEqual([languageGames[4]!]);
  });

  test("excludes missing and null languages from a specific language filter", () => {
    expect(
      filterBoardGames(games, {
        playerCount: null,
        durations: [],
        search: "",
        language: "cz",
      })
    ).toEqual([games[0]!]);
  });

  test("keeps games with incomplete metadata until a matching filter is active", () => {
    expect(
      filterBoardGames(games, {
        playerCount: null,
        durations: [],
        search: "",
      })
    ).toEqual([games[0]!, games[1]!, games[3]!, games[4]!]);

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

  test("matches a game against any selected duration bucket", () => {
    const timedGames = [30, 31, 60, 61, 120, 121].map((minutes) => ({
      name: `${minutes} minutes`,
      playingTimeMinutes: minutes,
      inStock: true,
    }));
    const minutesFor = (
      durations: Parameters<typeof toggleDurationFilter>[0]
    ) =>
      filterBoardGames(timedGames, {
        playerCount: null,
        durations,
        search: "",
      }).map((game) => game.playingTimeMinutes);

    expect(minutesFor(["upTo30"])).toEqual([30]);
    expect(minutesFor(["upTo60"])).toEqual([31, 60]);
    expect(minutesFor(["upTo120"])).toEqual([61, 120]);
    expect(minutesFor(["over120"])).toEqual([121]);
    expect(minutesFor(["upTo30", "over120"])).toEqual([30, 121]);
  });

  test("matches a player count within the game's range and 7 as seven or more", () => {
    const playerGames = [
      { name: "Solo", minPlayers: 1, maxPlayers: 1, inStock: true },
      { name: "Party", minPlayers: 4, maxPlayers: 10, inStock: true },
    ];
    const namesFor = (playerCount: number) =>
      filterBoardGames(playerGames, {
        playerCount,
        durations: [],
        search: "",
      }).map((game) => game.name);

    expect(namesFor(1)).toEqual(["Solo"]);
    expect(namesFor(3)).toEqual([]);
    expect(namesFor(7)).toEqual(["Party"]);
  });
});

describe("toggleDurationFilter", () => {
  test("adds an unselected duration after the current selection", () => {
    expect(toggleDurationFilter(["upTo30"], "over120")).toEqual([
      "upTo30",
      "over120",
    ]);
  });

  test("removes a selected duration and keeps the rest in order", () => {
    expect(
      toggleDurationFilter(["upTo30", "upTo60", "over120"], "upTo60")
    ).toEqual(["upTo30", "over120"]);
  });
});
