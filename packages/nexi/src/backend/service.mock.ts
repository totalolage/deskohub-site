import { Layer } from "effect";
import { NexiService } from "./service";

export const NexiServiceMock = Layer.mock(NexiService);
