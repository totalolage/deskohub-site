import { ArrowRight } from "lucide-react";

const spaces = [
  {
    title: "Hot Desks",
    description:
      "Flexible seating in our open workspace. Perfect for freelancers and those who thrive in a collaborative environment.",
    image:
      "https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800&h=600&fit=crop",
    features: [
      "Flexible daily/weekly plans",
      "High-speed WiFi",
      "Locker storage",
    ],
  },
  {
    title: "Dedicated Desks",
    description:
      "Your own permanent desk in a shared space. Ideal for those who need a consistent workspace with added privacy.",
    image:
      "https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&h=600&fit=crop",
    features: ["24/7 access", "Personal storage", "Mail handling"],
  },
  {
    title: "Private Offices",
    description:
      "Fully furnished private offices for teams of 2-20. Complete privacy with all the benefits of coworking.",
    image:
      "https://images.unsplash.com/photo-1497215842964-222b430dc094?w=800&h=600&fit=crop",
    features: [
      "Custom branding",
      "Meeting room credits",
      "Dedicated phone line",
    ],
  },
  {
    title: "Meeting Rooms",
    description:
      "Professional meeting spaces for client presentations, team sessions, or video conferences.",
    image:
      "https://images.unsplash.com/photo-1431540015161-0bf868a2d407?w=800&h=600&fit=crop",
    features: ["AV equipment", "Whiteboard walls", "Catering available"],
  },
];

export function Spaces() {
  return (
    <section id="spaces" className="py-20 lg:py-32 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Our Spaces
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground text-balance">
            Find the perfect space for your work style
          </h2>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
            From open coworking areas to private offices, we have flexible
            workspace solutions designed to help you do your best work.
          </p>
        </div>

        {/* Spaces Grid */}
        <div className="mt-16 grid md:grid-cols-2 gap-8">
          {spaces.map((space, _index) => (
            <div
              key={space.title}
              className="group relative rounded-2xl overflow-hidden bg-card border border-border hover:shadow-xl transition-all duration-300"
            >
              <div className="aspect-[4/3] overflow-hidden">
                <img
                  src={space.image}
                  alt={space.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-6 lg:p-8">
                <h3 className="font-serif text-2xl font-bold text-foreground">
                  {space.title}
                </h3>
                <p className="mt-2 text-muted-foreground">
                  {space.description}
                </p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {space.features.map((feature) => (
                    <li
                      key={feature}
                      className="px-3 py-1 text-xs font-medium bg-secondary text-secondary-foreground rounded-full"
                    >
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href="#pricing"
                  className="mt-6 inline-flex items-center text-sm font-medium text-accent hover:text-accent/80 transition-colors"
                >
                  Learn more
                  <ArrowRight className="ml-1 h-4 w-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
