import { Clock, Star, Users } from "lucide-react";
import { getLocale, m } from "@/features/i18n";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { ImageWithFallback } from "@/shared/components/ui/image-with-fallback";
import { cn } from "@/shared/utils";
import { getLocalizedText } from "@/shared/utils/localization";
import type { BoardGame } from "../types/board-games.types";

interface BoardGamesCardProps {
  game: BoardGame;
}

export const BoardGamesCard = ({ game }: BoardGamesCardProps) => {
  const locale = getLocale();

  // Helper to format duration
  const formatDuration = (
    duration: number | [number, number] | string | undefined
  ): string => {
    if (typeof duration === "string") return duration;
    if (typeof duration === "number") return `${duration} min`;
    if (Array.isArray(duration)) return `${duration[0]}-${duration[1]} min`;
    return "";
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case "easy":
        return "text-green-400";
      case "medium":
        return "text-yellow-400";
      case "hard":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  const gameName = getLocalizedText(game.name, locale, "");

  return (
    <Card className="bg-gray-800 border-gray-700 hover:border-green-500 transition-colors">
      <CardHeader className="pb-4">
        <div className="relative">
          <ImageWithFallback
            src={game.image || `/images/games/board-games/${game.name}.jpg`}
            fallbackSrc="/assets/images/placeholder/placeholder.svg"
            alt={gameName}
            width={200}
            height={200}
            className="w-full h-48 object-cover rounded-lg"
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between mb-2">
          <CardTitle className="text-white text-lg">{gameName}</CardTitle>
          <div className="flex items-center">
            <Star className="w-4 h-4 text-yellow-400 fill-current" />
            <span className="text-sm text-gray-300 ml-1">{game.rating}</span>
          </div>
        </div>

        {game.description && (
          <p className="text-gray-400 text-sm mb-4 line-clamp-2">
            {getLocalizedText(game.description, locale)}
          </p>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {game.players && (
            <Badge variant="outline" className="border-gray-600 text-gray-300">
              <Users className="w-3 h-3 mr-1" />
              {game.players}
            </Badge>
          )}
          <Badge variant="outline" className="border-gray-600 text-gray-300">
            <Clock className="w-3 h-3 mr-1" />
            {formatDuration(game.duration)}
          </Badge>
          {game.difficulty && (
            <Badge
              variant="outline"
              className={cn(
                "border-gray-600",
                getDifficultyColor(game.difficulty)
              )}
            >
              {m[`boardGames.filters.difficulties.${game.difficulty}`]()}
            </Badge>
          )}
        </div>

        {game.category && (
          <Badge className="bg-green-500/20 text-green-400 hover:bg-green-500/30">
            {game.category}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
};
