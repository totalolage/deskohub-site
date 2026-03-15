import { Calendar, Lightbulb, MessageCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

const events = [
  {
    title: "Startup Pitch Night",
    date: "Every 2nd Tuesday",
    type: "Networking",
    attendees: 45,
  },
  {
    title: "Design Thinking Workshop",
    date: "Mar 20, 2026",
    type: "Workshop",
    attendees: 20,
  },
  {
    title: "Freelancer Meetup",
    date: "Every Friday 5PM",
    type: "Social",
    attendees: 30,
  },
];

const testimonials = [
  {
    quote:
      "deskohub has transformed how I work. The community here is incredible, and I've made connections that have directly led to new clients.",
    author: "Sarah Chen",
    role: "UX Designer",
    image:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
  },
  {
    quote:
      "As a startup founder, having a professional space to meet investors and work with my team has been invaluable. The meeting rooms are top-notch.",
    author: "Marcus Johnson",
    role: "Tech Founder",
    image:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
  },
  {
    quote:
      "I love the flexibility of the hot desk membership. Some days I need quiet focus, other days I want to collaborate. deskohub offers both.",
    author: "Emma Rodriguez",
    role: "Content Strategist",
    image:
      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop",
  },
];

export function Community() {
  return (
    <section
      id="community"
      className="py-20 lg:py-32 bg-primary text-primary-foreground"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Left - Community Info */}
          <div>
            <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
              Community
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-balance">
              More than just a workspace
            </h2>
            <p className="mt-4 text-lg text-primary-foreground/80 leading-relaxed">
              Join a thriving community of creators, entrepreneurs, and
              professionals. Connect, collaborate, and grow together through our
              regular events and meetups.
            </p>

            {/* Stats */}
            <div className="mt-10 grid grid-cols-2 gap-8">
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary-foreground/10">
                  <Users className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <p className="font-serif text-3xl font-bold">500+</p>
                  <p className="text-sm text-primary-foreground/70">
                    Active members
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary-foreground/10">
                  <Calendar className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <p className="font-serif text-3xl font-bold">50+</p>
                  <p className="text-sm text-primary-foreground/70">
                    Events monthly
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary-foreground/10">
                  <Lightbulb className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <p className="font-serif text-3xl font-bold">80+</p>
                  <p className="text-sm text-primary-foreground/70">
                    Companies formed
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary-foreground/10">
                  <MessageCircle className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <p className="font-serif text-3xl font-bold">1000+</p>
                  <p className="text-sm text-primary-foreground/70">
                    Connections made
                  </p>
                </div>
              </div>
            </div>

            {/* Upcoming Events */}
            <div className="mt-12">
              <h3 className="font-serif text-xl font-bold mb-6">
                Upcoming Events
              </h3>
              <div className="space-y-4">
                {events.map((event) => (
                  <div
                    key={event.title}
                    className="flex items-center justify-between p-4 rounded-xl bg-primary-foreground/5 border border-primary-foreground/10"
                  >
                    <div>
                      <p className="font-medium">{event.title}</p>
                      <p className="text-sm text-primary-foreground/60">
                        {event.date}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="px-3 py-1 text-xs font-medium bg-accent/20 text-accent rounded-full">
                        {event.type}
                      </span>
                      <p className="text-xs text-primary-foreground/60 mt-1">
                        {event.attendees} attending
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <Button className="mt-6 bg-accent text-accent-foreground hover:bg-accent/90">
                View All Events
              </Button>
            </div>
          </div>

          {/* Right - Testimonials */}
          <div className="space-y-6">
            <h3 className="font-serif text-xl font-bold mb-6">
              What our members say
            </h3>
            {testimonials.map((testimonial, _index) => (
              <div
                key={testimonial.author}
                className="p-6 rounded-2xl bg-primary-foreground/5 border border-primary-foreground/10"
              >
                <p className="text-primary-foreground/90 leading-relaxed">
                  "{testimonial.quote}"
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <img
                    src={testimonial.image}
                    alt={testimonial.author}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <p className="font-medium">{testimonial.author}</p>
                    <p className="text-sm text-primary-foreground/60">
                      {testimonial.role}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
