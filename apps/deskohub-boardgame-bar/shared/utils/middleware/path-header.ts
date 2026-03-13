import { createPathnameHeaders } from "@deskohub/i18n/next";
import { locales } from "@/features/i18n";
import { PATHNAME_HEADER } from "@/shared/utils/constants";
import type { MiddlewareFactory } from "@/shared/utils/middleware-chain";

export const pathHeaderMiddleware: MiddlewareFactory =
  (next) => async (req, event, incomingResponse) => {
    const updatedHeaders = createPathnameHeaders(req.headers, {
      pathname: req.nextUrl.pathname,
      locales,
      headerName: PATHNAME_HEADER,
    });

    return next(
      Object.assign({}, req, { headers: updatedHeaders }),
      event,
      incomingResponse
    );
  };
