import { ArrowRight, Coffee, Users, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-secondary/30" />
      <div className="absolute top-20 right-0 w-[600px] h-[600px] bg-accent/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-primary/5 rounded-full blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left Content */}
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary text-sm font-medium text-foreground/80 mb-6">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              Now open in Downtown
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight text-foreground text-balance">
              Where ideas meet
              <span className="text-accent"> opportunity</span>
            </h1>

            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              A modern coworking and meetup space designed for freelancers,
              remote teams, and startups. Work better together in a space that
              inspires collaboration.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Button
                size="lg"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Book a Tour
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline">
                View Pricing
              </Button>
            </div>

            {/* Quick Stats */}
            <div className="mt-12 flex items-center gap-8 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-accent/10">
                  <Users className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">500+</p>
                  <p className="text-xs text-muted-foreground">Members</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-accent/10">
                  <Wifi className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">1Gbps</p>
                  <p className="text-xs text-muted-foreground">Internet</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-accent/10">
                  <Coffee className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">24/7</p>
                  <p className="text-xs text-muted-foreground">Access</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Content - Image Grid */}
          <div className="relative lg:h-[600px]">
            <div className="grid grid-cols-2 gap-4 h-full">
              <div className="space-y-4">
                <div className="relative h-48 lg:h-64 rounded-2xl overflow-hidden bg-secondary">
                  <img
                    src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop"
                    alt="Modern workspace with desks and natural lighting"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="relative h-40 lg:h-56 rounded-2xl overflow-hidden bg-secondary">
                  <img
                    src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&h=400&fit=crop"
                    alt="Team collaboration in a meeting room"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              <div className="space-y-4 pt-8">
                <div className="relative h-40 lg:h-56 rounded-2xl overflow-hidden bg-secondary">
                  <img
                    src="https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?w=600&h=400&fit=crop"
                    alt="Comfortable lounge area for informal meetings"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="relative h-48 lg:h-64 rounded-2xl overflow-hidden bg-primary text-primary-foreground flex items-center justify-center p-6">
                  <div className="text-center">
                    <p className="font-serif text-3xl font-bold">50+</p>
                    <p className="text-sm opacity-80 mt-1">Events monthly</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
