import { Layer } from "effect";
import { BotProtectionService } from "./bot-protection.service";

export const BotProtectionServiceMock = Layer.mock(BotProtectionService);
