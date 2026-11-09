import { markPrivateResponse } from "./private-response";

/**
 * A private file download. Every character of `filename` outside ASCII
 * letters, digits, `_`, `.`, and `-` becomes `_`, so the name stays inside
 * its quotes.
 */
export const createDownloadResponse = ({
  body,
  contentType,
  filename,
}: {
  readonly body: BodyInit;
  readonly contentType: string;
  /** An ASCII file name such as `WS-FV-2026-000042.pdf`. */
  readonly filename: string;
}) =>
  markPrivateResponse(
    new Response(body, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename.replaceAll(/[^\w.-]/g, "_")}"`,
        "Content-Type": contentType,
      },
    })
  );
