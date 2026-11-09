import type { Game } from "@deskohub/games";
import placeholderImage from "@/assets/images/placeholder/placeholder.svg";
import { m } from "@/features/i18n";
import { Badge } from "@/shared/components/ui/badge";
import { ImageWithFallback } from "@/shared/components/ui/image-with-fallback";
import type { GameLanguage } from "../utils/filter-board-games";

export type ListedBoardGame = Pick<
  Game,
  | "id"
  | "bggId"
  | "name"
  | "imageUrl"
  | "description"
  | "minPlayers"
  | "maxPlayers"
  | "playingTimeMinutes"
  | "rating"
  | "inStock"
  | "language"
>;

const languageBadges = {
  any: {
    className:
      "rounded-md border-[#d7a84b] bg-transparent px-1.5 py-0.5 font-bold text-[#ffe5a3] text-[10px] tracking-[.08em] uppercase",
    label: () => m["boardGames.filters.languageIndependent"](),
  },
  cz: {
    className:
      "rounded-md border-[#4fbba3] bg-transparent px-1.5 py-0.5 font-bold text-[#a8f0d9] text-[10px] tracking-[.08em] uppercase",
    label: () => m["boardGames.filters.czech"](),
  },
  en: {
    className:
      "rounded-md border-[#6fa8dc] bg-transparent px-1.5 py-0.5 font-bold text-[#b9d8ff] text-[10px] tracking-[.08em] uppercase",
    label: () => m["boardGames.filters.english"](),
  },
} as const satisfies Record<
  GameLanguage,
  { className: string; label: () => string }
>;

/** The game's player count, or null when either bound is unknown. */
export function boardGamePlayers(
  game: Pick<ListedBoardGame, "minPlayers" | "maxPlayers">
): string | null {
  const { minPlayers, maxPlayers } = game;
  if (typeof minPlayers !== "number" || typeof maxPlayers !== "number") {
    return null;
  }
  return minPlayers === maxPlayers
    ? m["boardGames.playerCount"]({ count: minPlayers })
    : m["boardGames.playerRange"]({ min: minPlayers, max: maxPlayers });
}

function GameLanguageBadge({ language }: { language: GameLanguage }) {
  const badge = languageBadges[language];
  return (
    <Badge className={badge.className} variant="outline">
      {badge.label()}
    </Badge>
  );
}

function BoardGameFacts({ game }: { game: ListedBoardGame }) {
  const players = boardGamePlayers(game);
  const minutes = game.playingTimeMinutes;
  if (
    game.language == null &&
    players === null &&
    typeof minutes !== "number"
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3.5 text-[#b9c2d1] text-xs">
      {game.language != null && <GameLanguageBadge language={game.language} />}
      {players !== null && (
        <span className="font-semibold text-[#4fbba3]">{players}</span>
      )}
      {typeof minutes === "number" && (
        <span>{m["boardGames.minutes"]({ count: minutes })}</span>
      )}
    </div>
  );
}

export function BoardGameCard({ game }: { game: ListedBoardGame }) {
  return (
    <a
      className="flex flex-col gap-2.5 rounded-2xl border border-[#3c3a36] bg-[#242422] p-4 transition hover:border-[#4fbba3]"
      href={`https://boardgamegeek.com/boardgame/${game.bggId}`}
      rel="noopener noreferrer"
      target="_blank"
    >
      <ImageWithFallback
        alt={game.name}
        className="mb-0.5 h-[150px] w-full rounded-[10px] bg-[#141311] object-contain"
        fallbackSrc={placeholderImage.src}
        height={300}
        sizes="(min-width: 1024px) 352px, (min-width: 640px) 50vw, 100vw"
        src={game.imageUrl ?? placeholderImage.src}
        width={600}
      />
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-base text-white leading-tight">
          {game.name}
        </h3>
        {typeof game.rating === "number" && (
          <span
            className="shrink-0 font-extrabold text-[#4fbba3] text-sm"
            title={m["boardGames.rating"]()}
          >
            {game.rating.toFixed(1)}
          </span>
        )}
      </div>
      <BoardGameFacts game={game} />
      {game.description && (
        <p className="line-clamp-3 text-[#b9c2d1] text-[13px] leading-normal">
          {game.description}
        </p>
      )}
    </a>
  );
}
