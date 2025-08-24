"use client";

import { track } from "@vercel/analytics";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { m } from "@/i18n";
import { Button } from "@/shared/components/ui/button";
import { siteConstants } from "@/shared/utils/constants";
import { generateMenuPDF } from "../actions/pdf-generator";

export function MenuPDFDownload() {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    try {
      setIsGenerating(true);
      track("Menu PDF Download");
      const result = await generateMenuPDF();

      if (result.success && result.pdfData) {
        // Convert base64 to blob
        const byteCharacters = atob(result.pdfData);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/pdf" });

        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download =
          result.filename ||
          `${siteConstants.brand.name.toLowerCase()}-menu.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the URL
        URL.revokeObjectURL(url);
      } else {
        console.error("Failed to generate menu PDF:", result.error);
        alert("Nepodařilo se vygenerovat PDF. Zkuste to prosím znovu.");
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Nepodařilo se vygenerovat PDF. Zkuste to prosím znovu.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="text-center mb-12">
      <Button
        onClick={handleDownload}
        disabled={isGenerating}
        className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-3 text-lg disabled:opacity-50"
      >
        {isGenerating ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        ) : (
          <Download className="mr-2 h-5 w-5" />
        )}
        {isGenerating ? "Generování PDF..." : m["menu.downloadPDF"]()}
      </Button>
    </div>
  );
}
