import { Effect } from "effect";
import GDPRText from "@/features/gdpr";
import { m } from "@/features/i18n";
import { LocalizedNextComponent } from "@/features/localization/localized-next-component";

export default LocalizedNextComponent.build(
  Effect.fn("GDPRPage")(function* () {
    return (
      <article className="prose prose-sm mx-auto mt-16">
        <h1>{m["gdpr.pageTitle"]()}</h1>
        {yield* GDPRText}
      </article>
    );
  })
);
