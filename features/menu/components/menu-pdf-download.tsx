"use client";

import { track } from "@vercel/analytics";
import { Download } from "lucide-react";
import { m } from "@/i18n";
import { Button } from "@/shared/components/ui/button";

export function MenuPDFDownload() {
  const handleClick = () => {
    track("Menu PDF Download");
  };

  return (
    <div className="text-center mb-12">
      <Button
        asChild
        className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-3 text-lg"
      >
        <a 
          href="/api/menu/pdf" 
          download
          onClick={handleClick}
        >
          <Download className="mr-2 h-5 w-5" />
          {m["menu.downloadPDF"]()}
        </a>
      </Button>
    </div>
  );
}
