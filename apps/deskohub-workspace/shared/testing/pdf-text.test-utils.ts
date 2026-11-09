import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * The text a PDF reader extracts from `bytes`, page by page and joined with
 * single spaces, so a test can look for what a rendered document shows.
 */
export const extractPdfText = async (bytes: Uint8Array) => {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replaceAll(/\s+/g, " ")
          .trim()
      );
    }

    return { pageCount: pdf.numPages, text: pages.join(" ") };
  } finally {
    await loadingTask.destroy();
  }
};
