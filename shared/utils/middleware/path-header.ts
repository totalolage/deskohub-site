import { PATHNAME_HEADER } from "@/shared/utils/constants";
import { localeUrl } from "@/i18n/utils/locale-url";
import { MiddlewareFactory } from "@/shared/utils/middleware-chain";

export const pathHeaderMiddleware: MiddlewareFactory =
  (next) => async (req, event, incomingResponse) => {
    const updatedHeaders = new Headers(req.headers);
    updatedHeaders.set(PATHNAME_HEADER, localeUrl.remove(req.nextUrl.pathname));

    return next(
      Object.assign({}, req, { headers: updatedHeaders }),
      event,
      incomingResponse,
    );
  };
