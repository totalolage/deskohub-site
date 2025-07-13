# DeskohHub - Gaming Bar & Restaurant

A modern web application for DeskohHub, featuring table reservations, workspace bookings, and an interactive showcase of our gaming collection.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/filip-kalny-projects/v0-recreate-ui-design)
[![Built with Next.js](https://img.shields.io/badge/Built%20with-Next.js-black?style=for-the-badge&logo=next.js)](https://nextjs.org)

## 🚀 Features

- **Restaurant Reservations**: Book tables with real-time availability
- **Workspace Bookings**: Reserve workspaces for meetings or coworking
- **Board Game Gallery**: Browse our collection of 200+ board games
- **Multi-language Support**: Czech and English translations
- **Responsive Design**: Optimized for all devices
- **Type-safe**: Built with TypeScript for reliability

## 📚 Documentation

Comprehensive documentation is available in the `/docs` directory:

- **[Project Structure](./docs/PROJECT_STRUCTURE.md)** - Understanding our feature-based architecture
- **[Designer Integration](./docs/DESIGNER_PAGE_INTEGRATION.md)** - Guide for integrating design exports
- **[Best Practices](./docs/BEST_PRACTICES.md)** - Coding standards and conventions

## 🛠️ Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) with App Router
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/)
- **Internationalization**: [Paraglide](https://inlang.com/m/gerre34r/library-inlang-paraglideJs)
- **Form Handling**: [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)
- **Package Manager**: [Bun](https://bun.sh/)

## 🏗️ Architecture

This project follows a **feature-based architecture** where code is organized by business features rather than technical layers. Each feature is self-contained with its own components, hooks, and logic.

```
features/
├── booking/          # Restaurant booking feature
├── navigation/       # Header and footer
├── gallery/          # Image and game galleries
├── home/            # Homepage sections
└── ...              # Other features
```

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (latest version)
- Node.js 18+ (for compatibility)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/deskohub-site.git

# Navigate to the project
cd deskohub-site

# Install dependencies
bun install
```

### Development

```bash
# Run the development server
bun run dev

# Type checking and linting
bun run lint

# Build for production
bun run build

# Start production server
bun run start
```

## 🌍 Environment Variables

Create a `.env.local` file in the root directory:

```env
# Add any required environment variables here
```

## 📦 Project Scripts

- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run start` - Start production server
- `bun run lint` - Run type checking and linting
- `bun run lint:fix` - Fix linting issues

## 🤝 Contributing

Please read our [Best Practices Guide](./docs/BEST_PRACTICES.md) before contributing.

1. Follow the feature-based architecture
2. Use TypeScript with strict types
3. Add translations for new text
4. Test on multiple screen sizes
5. Ensure accessibility standards

## 📄 License

This project is proprietary and confidential.