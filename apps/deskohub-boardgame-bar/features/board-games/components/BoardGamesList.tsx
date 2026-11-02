"use client";

import { useMemo, useState } from "react";
import { m } from "@/features/i18n";
import {
  type DurationFilter,
  filterBoardGames,
  type GameLanguage,
  toggleDurationFilter,
} from "../utils/filter-board-games";
import { BoardGameCard, type ListedBoardGame } from "./BoardGameCard";

const playerOptions = [1, 2, 3, 4, 5, 6, 7] as const;

const durationOptions = [
  { id: "upTo30", label: () => m["boardGames.filters.upTo30"]() },
  { id: "upTo60", label: () => m["boardGames.filters.upTo60"]() },
  { id: "upTo120", label: () => m["boardGames.filters.upTo120"]() },
  { id: "over120", label: () => m["boardGames.filters.over120"]() },
] as const satisfies ReadonlyArray<{
  id: DurationFilter;
  label: () => string;
}>;

const languageOptions = [
  { id: null, label: () => m["boardGames.filters.allLanguages"]() },
  { id: "cz", label: () => m["boardGames.filters.czech"]() },
  { id: "en", label: () => m["boardGames.filters.english"]() },
  {
    id: "any",
    label: () => m["boardGames.filters.languageIndependent"](),
  },
] as const satisfies ReadonlyArray<{
  id: GameLanguage | null;
  label: () => string;
}>;

interface BoardGamesListProps {
  games: ReadonlyArray<ListedBoardGame>;
}

export function BoardGamesList({ games }: BoardGamesListProps) {
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [durations, setDurations] = useState<ReadonlyArray<DurationFilter>>([]);
  const [language, setLanguage] = useState<GameLanguage | null>(null);
  const [search, setSearch] = useState("");

  const filteredGames = useMemo(
    () => filterBoardGames(games, { playerCount, durations, language, search }),
    [games, playerCount, durations, language, search]
  );

  const reset = () => {
    setPlayerCount(null);
    setDurations([]);
    setLanguage(null);
    setSearch("");
  };

  const toggleDuration = (duration: DurationFilter) => {
    setDurations((selected) => toggleDurationFilter(selected, duration));
  };

  return (
    <div className="bg-[#141311] px-4 py-8 text-[#f7f1e0] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <section aria-label={m["boardGames.filters.label"]()} className="pb-6">
          <div className="mb-5">
            <h2 className="mb-3 font-semibold text-[#b9c2d1] text-xs uppercase tracking-[.14em]">
              {m["boardGames.filters.playersQuestion"]()}
            </h2>
            <div className="flex flex-wrap gap-2.5">
              {playerOptions.map((player) => {
                const active = playerCount === player;
                return (
                  <button
                    aria-label={
                      player === 7
                        ? m["boardGames.filters.sevenOrMorePlayers"]()
                        : m["boardGames.playerCount"]({ count: player })
                    }
                    aria-pressed={active}
                    className="flex size-[52px] shrink-0 items-center justify-center rounded-full border-2 border-[#4fbba3]/40 border-dashed bg-[#0d0c0b] font-extrabold text-white transition hover:-translate-y-0.5 hover:border-[#4fbba3] aria-pressed:border-solid aria-pressed:border-[#37a68f] aria-pressed:bg-[#2e8e7a] aria-pressed:shadow-[0_6px_16px_-4px_rgba(46,142,122,.5)]"
                    key={player}
                    onClick={() => setPlayerCount(active ? null : player)}
                    type="button"
                  >
                    {player === 7 ? "7+" : player}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-5">
            <h2 className="mb-3 font-semibold text-[#b9c2d1] text-xs uppercase tracking-[.14em]">
              {m["boardGames.filters.timeQuestion"]()}
            </h2>
            <div className="flex flex-wrap gap-2">
              {durationOptions.map((duration) => (
                <button
                  aria-pressed={durations.includes(duration.id)}
                  className="rounded-full border border-[#3c3a36] px-4 py-2 font-semibold text-[#b9c2d1] text-[13px] transition hover:border-[#4fbba3] hover:text-white aria-pressed:border-[#2e8e7a] aria-pressed:bg-[#2e8e7a] aria-pressed:text-white"
                  key={duration.id}
                  onClick={() => toggleDuration(duration.id)}
                  type="button"
                >
                  {duration.label()}
                </button>
              ))}
            </div>
          </div>

          <fieldset className="mb-5 border-0 p-0">
            <legend className="mb-3 font-semibold text-[#b9c2d1] text-xs uppercase tracking-[.14em]">
              {m["boardGames.filters.languageQuestion"]()}
            </legend>
            <div className="flex flex-wrap gap-2">
              {languageOptions.map((languageOption) => {
                const active = language === languageOption.id;
                return (
                  <button
                    aria-pressed={active}
                    className="h-auto rounded-full border border-[#3c3a36] bg-transparent px-4 py-2 font-semibold text-[#b9c2d1] text-[13px] transition hover:border-[#4fbba3] hover:bg-transparent hover:text-white aria-pressed:border-[#2e8e7a] aria-pressed:bg-[#2e8e7a] aria-pressed:text-white"
                    key={languageOption.id ?? "all"}
                    onClick={() => setLanguage(languageOption.id)}
                    type="button"
                  >
                    {languageOption.label()}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3 border-[#3c3a36] border-t py-3.5">
            <strong
              aria-live="polite"
              className="font-extrabold text-[#4fbba3] text-lg"
            >
              {m["boardGames.filters.foundGames"]({
                count: filteredGames.length,
              })}
            </strong>
            <button
              className="p-1 text-[#b9c2d1] text-[13px] underline decoration-1 underline-offset-[3px] hover:text-[#4fbba3]"
              onClick={reset}
              type="button"
            >
              {m["boardGames.filters.reset"]()}
            </button>
            <input
              aria-label={m["boardGames.filters.search"]()}
              className="ml-auto min-w-52 max-w-80 flex-1 rounded-[10px] border border-[#3c3a36] bg-[#141311] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-[#738096] focus:border-[#4fbba3]"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={m["boardGames.filters.searchPlaceholder"]()}
              type="search"
              value={search}
            />
          </div>
        </section>

        {filteredGames.length === 0 ? (
          <div className="rounded-2xl border border-[#3c3a36] border-dashed px-5 py-14 text-center text-[#b9c2d1]">
            <strong className="mb-1.5 block text-[#f7f1e0] text-lg">
              {m["boardGames.empty.title"]()}
            </strong>
            {m["boardGames.empty.hint"]()}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGames.map((game) => (
              <BoardGameCard game={game} key={game.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
