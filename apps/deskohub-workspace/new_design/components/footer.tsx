import { Facebook, Instagram, Linkedin, Twitter } from "lucide-react";
import { Logo } from "./logo";

const footerLinks = {
  Spaces: [
    { label: "Hot Desks", href: "#spaces" },
    { label: "Dedicated Desks", href: "#spaces" },
    { label: "Private Offices", href: "#spaces" },
    { label: "Meeting Rooms", href: "#spaces" },
    { label: "Event Spaces", href: "#spaces" },
  ],
  Community: [
    { label: "Events", href: "#community" },
    { label: "Member Directory", href: "#" },
    { label: "Blog", href: "#" },
    { label: "Partnerships", href: "#" },
  ],
  Company: [
    { label: "About Us", href: "#" },
    { label: "Careers", href: "#" },
    { label: "Press", href: "#" },
    { label: "Contact", href: "#contact" },
  ],
  Legal: [
    { label: "Terms of Service", href: "#" },
    { label: "Privacy Policy", href: "#" },
    { label: "Cookie Policy", href: "#" },
  ],
};

const socialLinks = [
  { icon: Instagram, href: "#", label: "Instagram" },
  { icon: Twitter, href: "#", label: "Twitter" },
  { icon: Linkedin, href: "#", label: "LinkedIn" },
  { icon: Facebook, href: "#", label: "Facebook" },
];

export function Footer() {
  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-12">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Logo variant="dark" />
            <p className="mt-4 text-primary-foreground/70 max-w-xs">
              A modern coworking and meetup space designed for the way you work.
              Join our community today.
            </p>
            <div className="mt-6 flex items-center gap-4">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-primary-foreground/10 hover:bg-primary-foreground/20 transition-colors"
                  aria-label={social.label}
                >
                  <social.icon className="w-5 h-5" />
                </a>
              ))}
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="font-medium text-primary-foreground mb-4">
                {category}
              </h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="mt-16 pt-8 border-t border-primary-foreground/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-primary-foreground/60">
            © {new Date().getFullYear()} deskohub cowork. All rights reserved.
          </p>
          <p className="text-sm text-primary-foreground/60">
            Made with care in New York City
          </p>
        </div>
      </div>
    </footer>
  );
}
