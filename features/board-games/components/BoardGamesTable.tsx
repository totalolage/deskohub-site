import { Clock, Star, Users } from "lucide-react";
import Image from "next/image";
import { getLocale, m } from "@/i18n";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/utils";
import type { TranslatableString } from "@/types/translatable-string";
import type { BoardGame } from "../types/board-games.types";

interface BoardGamesTableProps {
  games: BoardGame[];
}

export const BoardGamesTable = ({ games }: BoardGamesTableProps) => {
  const locale = getLocale();

  // Helper to get localized text
  const getLocalizedText = (text: TranslatableString | undefined): string => {
    if (!text) return "";
    if (typeof text === "string") return text;
    return text[locale] || "";
  };

  // Helper to format duration
  const formatDuration = (
    duration: number | [number, number] | string | undefined
  ): string => {
    if (!duration) return "";
    if (typeof duration === "string") return duration;
    if (typeof duration === "number") return `${duration} min`;
    if (Array.isArray(duration)) return `${duration[0]}-${duration[1]} min`;
    return "";
  };

  const getDifficultyColorClasses = (difficulty: string) => {
    switch (difficulty) {
      case "easy":
        return "text-green-400 border-green-400";
      case "medium":
        return "text-yellow-400 border-yellow-400";
      case "hard":
        return "text-red-400 border-red-400";
      default:
        return "text-gray-400 border-gray-400";
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-300 uppercase tracking-wider">
                {m["boardGames.table.game"]()}
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-300 uppercase tracking-wider">
                {m["boardGames.table.players"]()}
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-300 uppercase tracking-wider">
                {m["boardGames.table.duration"]()}
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-300 uppercase tracking-wider">
                {m["boardGames.table.difficulty"]()}
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-300 uppercase tracking-wider">
                {m["boardGames.table.category"]()}
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-300 uppercase tracking-wider">
                {m["boardGames.table.rating"]()}
              </th>
              <th className="px-6 py-4 text-left text-sm font-medium text-gray-300 uppercase tracking-wider">
                {m["boardGames.table.availability"]()}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {games.map((game) => (
              <tr key={game.id} className="hover:bg-gray-700 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Image
                      src={game.image || "/placeholder.svg"}
                      alt={getLocalizedText(game.name)}
                      width={48}
                      height={48}
                      className="w-12 h-12 object-cover rounded-lg mr-4"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">
                        {getLocalizedText(game.name)}
                      </div>
                      <div className="text-sm text-gray-400 max-w-xs truncate">
                        {getLocalizedText(game.description)}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm text-gray-300">
                    <Users className="w-4 h-4 mr-1" />
                    {game.players || "-"}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm text-gray-300">
                    <Clock className="w-4 h-4 mr-1" />
                    {formatDuration(game.duration)}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {game.difficulty ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-gray-600",
                        getDifficultyColorClasses(game.difficulty)
                      )}
                    >
                      {m[
                        `boardGames.filters.difficulties.${game.difficulty}`
                      ]()}
                    </Badge>
                  ) : (
                    <span className="text-gray-500">-</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {game.category ? (
                    <Badge className="bg-green-500/20 text-green-400 hover:bg-green-500/30">
                      {game.category}
                    </Badge>
                  ) : (
                    <span className="text-gray-500">-</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Star className="w-4 h-4 text-yellow-400 fill-current mr-1" />
                    <span className="text-sm text-gray-300">{game.rating}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={cn(
                      "inline-flex px-2 py-1 text-xs font-semibold rounded-full",
                      game.available
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    )}
                  >
                    {game.available
                      ? m["boardGames.available"]()
                      : m["boardGames.unavailable"]()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
