import { Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import { extractLocaleFromRequest } from "@/features/i18n";
import { LocaleValue } from "@/features/localization/effect-locale";
import { generateMenuPdf, MenuData } from "@/features/menu";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("Menu PDF generation started");
      const menuPdfStream = yield* generateMenuPdf.pipe(
        Effect.provide(MenuData.Default)
      );
      yield* Effect.logInfo("Menu PDF generation succeeded");

      // @ts-expect-error - NextResponse is not typed correctly int he latest Next.js version, remove once it's fixed
      const response = new NextResponse(menuPdfStream, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="deskohub-menu.pdf"',
        },
      });
      yield* Effect.logInfo("Menu PDF response ready");
      return response;
    }).pipe(
      Effect.annotateLogs({
        method: "GET",
        url: request.url,
        headers: {
          host: request.headers.get("host"),
          referer: request.headers.get("referer"),
          "user-agent": request.headers.get("user-agent"),
        },
      }),
      Effect.tapError(Effect.logError),
      Effect.catch(() =>
        Effect.succeed(
          new NextResponse("Failed to generate PDF", { status: 500 })
        )
      ),
      Effect.provideService(LocaleValue, extractLocaleFromRequest(request))
    )
  );
}
