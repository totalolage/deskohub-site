import { Clock, Star, Users } from "lucide-react";
import Image from "next/image";
import { m } from "@/i18n";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";
import type { BoardGame } from "../types/board-games.types";

interface BoardGamesCardProps {
  game: BoardGame;
}

export const BoardGamesCard = ({ game }: BoardGamesCardProps) => {
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

  return (
    <Card className="bg-gray-800 border-gray-700 hover:border-green-500 transition-colors">
      <CardHeader className="pb-4">
        <div className="relative">
          <Image
            src={game.image || "/placeholder.svg"}
            alt={game.name}
            width={200}
            height={200}
            className="w-full h-48 object-cover rounded-lg"
          />
          {!game.available && (
            <div className="absolute inset-0 bg-black bg-opacity-60 rounded-lg flex items-center justify-center">
              <span className="text-red-400 font-semibold">
                {m["boardGames.unavailable"]()}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between mb-2">
          <CardTitle className="text-white text-lg">{game.name}</CardTitle>
          <div className="flex items-center">
            <Star className="w-4 h-4 text-yellow-400 fill-current" />
            <span className="text-sm text-gray-300 ml-1">{game.rating}</span>
          </div>
        </div>

        <p className="text-gray-400 text-sm mb-4">{game.description}</p>

        <div className="flex flex-wrap gap-2 mb-4">
          <Badge variant="outline" className="border-gray-600 text-gray-300">
            <Users className="w-3 h-3 mr-1" />
            {game.players}
          </Badge>
          <Badge variant="outline" className="border-gray-600 text-gray-300">
            <Clock className="w-3 h-3 mr-1" />
            {game.duration}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "border-gray-600",
              getDifficultyColor(game.difficulty)
            )}
          >
            {m[`boardGames.filters.difficulties.${game.difficulty}`]()}
          </Badge>
        </div>

        <Badge className="bg-green-500/20 text-green-400 hover:bg-green-500/30">
          {game.category}
        </Badge>
      </CardContent>
    </Card>
  );
};
