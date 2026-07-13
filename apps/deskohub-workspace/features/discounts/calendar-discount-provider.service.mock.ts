import { Layer } from "effect";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";

export const CalendarDiscountProviderMock = Layer.mock(
  CalendarDiscountProvider
);
