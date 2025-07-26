"use client";

import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { ViewMode } from "../types/board-games.types";

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export const ViewModeToggle = ({ viewMode, onChange }: ViewModeToggleProps) => {
  return (
    <div className="flex items-center bg-gray-700 rounded-lg p-1">
      <Button
        variant={viewMode === "cards" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChange("cards")}
        className={
          viewMode === "cards"
            ? "bg-green-500 hover:bg-green-600 text-white"
            : "text-gray-400 hover:text-white hover:bg-gray-600"
        }
      >
        <LayoutGrid className="w-4 h-4" />
      </Button>
      <Button
        variant={viewMode === "table" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChange("table")}
        className={
          viewMode === "table"
            ? "bg-green-500 hover:bg-green-600 text-white"
            : "text-gray-400 hover:text-white hover:bg-gray-600"
        }
      >
        <List className="w-4 h-4" />
      </Button>
    </div>
  );
};
