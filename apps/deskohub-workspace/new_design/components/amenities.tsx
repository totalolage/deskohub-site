import {
  Bike,
  Calendar,
  Coffee,
  Lock,
  Monitor,
  Phone,
  Printer,
  Users,
  UtensilsCrossed,
  Wifi,
} from "lucide-react";

const amenities = [
  {
    icon: Wifi,
    title: "High-Speed Internet",
    description:
      "1Gbps fiber connection with enterprise-grade security and redundant backup.",
  },
  {
    icon: Coffee,
    title: "Premium Coffee & Tea",
    description:
      "Locally roasted specialty coffee and curated tea selection, always fresh.",
  },
  {
    icon: Printer,
    title: "Print & Scan",
    description:
      "Professional printing, scanning, and copying services included in your membership.",
  },
  {
    icon: Users,
    title: "Community Events",
    description:
      "Weekly networking events, workshops, and social gatherings for members.",
  },
  {
    icon: Calendar,
    title: "Room Booking",
    description:
      "Easy online booking system for meeting rooms and event spaces.",
  },
  {
    icon: Lock,
    title: "24/7 Secure Access",
    description:
      "Keycard entry with 24/7 access for all dedicated desk and office members.",
  },
  {
    icon: Phone,
    title: "Phone Booths",
    description:
      "Soundproof phone booths for private calls and video conferences.",
  },
  {
    icon: Bike,
    title: "Bike Storage",
    description:
      "Secure indoor bike storage with shower and changing facilities.",
  },
  {
    icon: UtensilsCrossed,
    title: "Kitchen & Lounge",
    description:
      "Fully equipped kitchen, snack bar, and comfortable lounge areas.",
  },
  {
    icon: Monitor,
    title: "Tech Support",
    description: "On-site IT support and tech equipment available for loan.",
  },
];

export function Amenities() {
  return (
    <section id="amenities" className="py-20 lg:py-32 bg-secondary/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Amenities
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground text-balance">
            Everything you need to work better
          </h2>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
            We've thought of everything so you can focus on what matters most —
            your work.
          </p>
        </div>

        {/* Amenities Grid */}
        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-5 gap-6">
          {amenities.map((amenity, _index) => (
            <div
              key={amenity.title}
              className="group p-6 rounded-xl bg-card border border-border hover:border-accent/30 hover:shadow-lg transition-all duration-300"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground transition-colors duration-300">
                <amenity.icon className="w-6 h-6" />
              </div>
              <h3 className="mt-4 font-serif text-lg font-bold text-foreground">
                {amenity.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {amenity.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
