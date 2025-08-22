"use client";

import { Download } from "lucide-react";
import { m } from "@/i18n";
import { Button } from "@/shared/components/ui/button";
import { generateMenuPDF } from "../actions/pdf-generator";

export function MenuPDFDownload() {
  const handleDownload = async () => {
    const result = await generateMenuPDF();

    if (result.success && result.htmlContent) {
      // Create blob and trigger download on client side
      const blob = new Blob([result.htmlContent], { type: "text/html" });
      const url = URL.createObjectURL(blob);

      // Create a temporary link element to trigger download
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || "deskohub-menu.html";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the URL
      URL.revokeObjectURL(url);
    } else {
      console.error("Failed to generate menu PDF");
    }
  };

  return (
    <div className="text-center mb-12">
      <Button
        onClick={handleDownload}
        className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-3 text-lg"
      >
        <Download className="mr-2 h-5 w-5" />
        {m["menu.downloadPDF"]()}
      </Button>
    </div>
  );
}
