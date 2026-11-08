import { requireOptionalNativeModule } from "expo";
import type {
  TrustedWebActivity,
  TrustedWebActivityColors,
  TrustedWebActivityProvider,
} from "./src/trusted-web-activity.types";

export type * from "./src/trusted-web-activity.types";

interface TrustedWebActivityNativeModule {
  getProvider(): TrustedWebActivityProvider | null;
  launch(
    url: string,
    packageName: string,
    colors: TrustedWebActivityColors
  ): Promise<void>;
  release(): Promise<void>;
}

// Looked up on first use, so importing this file loads no native code.
const nativeModule = () =>
  requireOptionalNativeModule<TrustedWebActivityNativeModule>(
    "TrustedWebActivity"
  );

export const trustedWebActivity: TrustedWebActivity = {
  findProvider: () => nativeModule()?.getProvider() ?? null,
  launch: async (url, provider, colors) => {
    const native = nativeModule();
    if (!native) throw new Error("The TrustedWebActivity module is missing");
    await native.launch(url, provider.packageName, colors);
  },
  release: async () => {
    await nativeModule()?.release();
  },
};
