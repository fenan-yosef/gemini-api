# Gemini API Project

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app). It integrates Google Generative AI and Cloudinary for image generation and storage, and includes a Telegram bot for interaction.

## Project Structure

### Key Files and Directories

- **`app/page.tsx`**: The main page of the application, showcasing the Next.js logo and links to documentation and examples.
- **`app/layout.tsx`**: Defines the root layout, including global fonts and metadata.
- **`app/globals.css`**: Contains global styles, including Tailwind CSS and custom theme variables.
- **`app/api/generate-image/route.ts`**: Implements the backend API for image generation using Google Generative AI and Cloudinary.
- **`next.config.ts`**: Configuration file for Next.js.
- **`postcss.config.mjs`**: Configuration for PostCSS, including Tailwind CSS plugins.
- **`tsconfig.json`**: TypeScript configuration file.
- **`.gitignore`**: Specifies files and directories to ignore in version control.
- **`package.json`**: Contains project dependencies and scripts.

## Features

### Image Generation API

The API at `app/api/generate-image/route.ts`:
- Moderates text prompts using Google Generative AI to ensure safety.
- Generates images based on user prompts using the Gemini image generation model.
- Uploads generated images to Cloudinary for secure storage.
- Returns the image URL and metadata to the client.

### Telegram Bot Integration

The API includes helper functions to send messages and images to Telegram:
- `sendTelegramMessage`: Sends text messages to a Telegram chat.
- `sendTelegramPhoto`: Sends image URLs to a Telegram chat.

### Tailwind CSS Integration

The project uses Tailwind CSS for styling:
- Global styles are defined in `app/globals.css`.
- Custom theme variables are used for background, foreground, and fonts.

### Font Optimization

The project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to load and optimize the Geist font family.

## Setup Instructions

### Prerequisites

- Node.js and npm installed.
- Environment variables set up:
  - `GEMINI_API_KEY`: API key for Google Generative AI.
  - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: Credentials for Cloudinary.
  - `TELEGRAM_BOT_TOKEN`: Token for the Telegram bot.
  - `SHARED_SECRET`: Shared secret for API security.

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd gemini-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env.local` file and add the required variables.

### Development

Start the development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build and Deployment

Build the application:
```bash
npm run build
```

Start the production server:
```bash
npm run start
```

Deploy the application using [Vercel](https://vercel.com).

## Learn More

To learn more about Next.js, take a look at the following resources:
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - Interactive Next.js tutorial.

## License

This project is licensed under the MIT License.
