import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

export function Contact() {
  return (
    <section className="py-16 bg-amber-900 text-white text-center">
      <div className="max-w-4xl mx-auto px-6">
        <h2 className="text-4xl md:text-5xl font-bold mb-8">
          {m["contactSection.title"]()}
          <br />
          {m["contactSection.subtitle"]()}
        </h2>
        <Button className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-full">
          {m["buttons.contact"]()}
        </Button>
      </div>
    </section>
  );
}
