import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Day Pass",
    price: "25",
    period: "per day",
    description: "Perfect for occasional visits or trying out the space.",
    features: [
      "Hot desk access",
      "High-speed WiFi",
      "Coffee & tea included",
      "Common area access",
      "Printing (10 pages)",
    ],
    cta: "Get Day Pass",
    popular: false,
  },
  {
    name: "Hot Desk",
    price: "299",
    period: "per month",
    description: "Flexible seating for freelancers and remote workers.",
    features: [
      "Unlimited hot desk access",
      "24/7 building access",
      "Locker storage",
      "2 meeting room hours/month",
      "Member events access",
      "Mail handling",
    ],
    cta: "Start Membership",
    popular: true,
  },
  {
    name: "Dedicated Desk",
    price: "499",
    period: "per month",
    description: "Your own permanent desk with added benefits.",
    features: [
      "Personal dedicated desk",
      "24/7 building access",
      "Personal storage cabinet",
      "5 meeting room hours/month",
      "Member events access",
      "Mail handling",
      "Phone booth priority",
    ],
    cta: "Reserve Desk",
    popular: false,
  },
  {
    name: "Private Office",
    price: "899",
    period: "per month",
    description: "Fully furnished private offices for teams.",
    features: [
      "Private lockable office",
      "24/7 building access",
      "Custom branding options",
      "10 meeting room hours/month",
      "Dedicated phone line",
      "All amenities included",
      "Priority support",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-20 lg:py-32 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Pricing
          </p>
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground text-balance">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
            Choose the plan that works best for you. All memberships include
            access to our community and basic amenities.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col p-6 rounded-2xl border transition-all duration-300 hover:shadow-lg",
                plan.popular
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-card-foreground border-border"
              )}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-medium bg-accent text-accent-foreground rounded-full">
                  Most Popular
                </span>
              )}

              <h3 className="font-serif text-xl font-bold">{plan.name}</h3>

              <div className="mt-4 flex items-baseline">
                <span className="font-serif text-4xl font-bold">
                  ${plan.price}
                </span>
                <span
                  className={cn(
                    "ml-2 text-sm",
                    plan.popular
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  )}
                >
                  {plan.period}
                </span>
              </div>

              <p
                className={cn(
                  "mt-3 text-sm",
                  plan.popular
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground"
                )}
              >
                {plan.description}
              </p>

              <ul className="mt-6 space-y-3 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check
                      className={cn(
                        "w-4 h-4 mt-0.5 shrink-0",
                        plan.popular ? "text-accent" : "text-accent"
                      )}
                    />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                className={cn(
                  "mt-8 w-full",
                  plan.popular
                    ? "bg-accent text-accent-foreground hover:bg-accent/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {plan.cta}
              </Button>
            </div>
          ))}
        </div>

        {/* Enterprise CTA */}
        <div className="mt-16 p-8 rounded-2xl bg-secondary text-center">
          <h3 className="font-serif text-2xl font-bold text-foreground">
            Need a custom solution?
          </h3>
          <p className="mt-2 text-muted-foreground max-w-xl mx-auto">
            We offer custom packages for larger teams and enterprise clients.
            Contact us to discuss your specific requirements.
          </p>
          <Button variant="outline" className="mt-6">
            Contact Sales Team
          </Button>
        </div>
      </div>
    </section>
  );
}
