import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

const companyExtractFileName = "deskohub-company-extract.pdf";
const companyExtractPath = join(process.cwd(), "assets", "vypis.pdf");

export async function GET() {
  const companyExtractBuffer = await readFile(companyExtractPath);

  return new NextResponse(companyExtractBuffer, {
    headers: {
      "Content-Disposition": `inline; filename="${companyExtractFileName}"`,
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
