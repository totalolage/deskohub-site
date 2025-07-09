import { createSafeActionClient } from "next-safe-action";
import { localeMiddleware } from "./middleware/locale";

export const actionClient = createSafeActionClient().use(localeMiddleware);
