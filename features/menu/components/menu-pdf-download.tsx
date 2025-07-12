"use client";

import { Download } from "lucide-react";
import { m } from "@/i18n";
import { Button } from "@/shared/components/ui/button";
import { generateMenuPDF } from "../actions/pdf-generator";

export function MenuPDFDownload() {
  return (
    <div className="text-center mb-12">
      <Button
        onClick={generateMenuPDF}
        className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-3 text-lg"
      >
        <Download className="mr-2 h-5 w-5" />
        {m["menu.downloadPDF"]()}
      </Button>
    </div>
  );
}
