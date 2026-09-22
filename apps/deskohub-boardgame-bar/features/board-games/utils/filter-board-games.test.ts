import { describe, expect, test } from "bun:test";
import { filterBoardGames } from "./filter-board-games";

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

  test("matches each specific language", () => {
    const languageGames = [
      { ...games[0]!, name: "Czech game", language: "cz" as const },
      { ...games[0]!, name: "English game", language: "en" as const },
      {
        ...games[0]!,
        name: "Language-independent game",
        language: "any" as const,
      },
    ];
    const filters = {
      playerCount: null,
      durations: [],
      search: "",
    };

    expect(
      filterBoardGames(languageGames, { ...filters, language: "cz" })
    ).toEqual([languageGames[0]!]);
    expect(
      filterBoardGames(languageGames, { ...filters, language: "en" })
    ).toEqual([languageGames[1]!]);
    expect(
      filterBoardGames(languageGames, { ...filters, language: "any" })
    ).toEqual([languageGames[2]!]);
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

  test("keeps all languages when the language filter is unset", () => {
    const filters = {
      playerCount: null,
      durations: [],
      search: "",
    };
    const availableGames = [games[0]!, games[1]!, games[3]!, games[4]!];

    expect(filterBoardGames(games, { ...filters, language: null })).toEqual(
      availableGames
    );
    expect(
      filterBoardGames(games, { ...filters, language: undefined })
    ).toEqual(availableGames);
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
});
