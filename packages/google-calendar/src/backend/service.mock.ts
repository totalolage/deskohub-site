import { Layer } from "effect";
import { GoogleCalendarService } from "./service";

export const GoogleCalendarServiceMock = Layer.mock(GoogleCalendarService);
