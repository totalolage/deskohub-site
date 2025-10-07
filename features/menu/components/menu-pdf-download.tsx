"use client";

import { track } from "@vercel/analytics";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

export function MenuPDFDownload() {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleClick = async () => {
    if (isGenerating) return;

    track("Menu PDF Download");
    setIsGenerating(true);

    try {
      const response = await fetch("/api/menu/pdf");
      if (!response.ok) {
        throw new Error("Failed to generate PDF");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "deskohub-menu.pdf";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download PDF:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="text-center mb-12">
      <Button
        onClick={handleClick}
        disabled={isGenerating}
        className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {m["menu.generatingPDF"]()}
          </>
        ) : (
          <>
            <Download className="mr-2 h-5 w-5" />
            {m["menu.downloadPDF"]()}
          </>
        )}
      </Button>
    </div>
  );
}
