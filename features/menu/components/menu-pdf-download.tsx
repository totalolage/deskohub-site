"use client";

import { track } from "@vercel/analytics";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { m } from "@/i18n";
import { Button } from "@/shared/components/ui/button";

export function MenuPDFDownload() {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleClick = () => {
    track("Menu PDF Download");
    setIsGenerating(true);
    
    // Reset the loading state after a reasonable time
    // This accounts for the PDF generation and download initiation
    setTimeout(() => {
      setIsGenerating(false);
    }, 3000);
  };

  return (
    <div className="text-center mb-12">
      <Button
        asChild
        disabled={isGenerating}
        className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <a 
          href={isGenerating ? "#" : "/api/menu/pdf"}
          download={!isGenerating}
          onClick={isGenerating ? (e: React.MouseEvent) => e.preventDefault() : handleClick}
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
        </a>
      </Button>
    </div>
  );
}
