# IBAYSOFT

IBAYSOFT is a Turkish-language business discovery dashboard built with Next.js, React, TypeScript, Tailwind CSS, and Google Maps JavaScript/Places APIs.

## Requirements

- Node.js 20.19+ or 22 LTS
- npm
- Google Maps JavaScript API and Places API enabled in a Google Cloud project
- Billing enabled for the Google Cloud project

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and add a Google Maps browser key. Restrict the key by HTTP referrer and API.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
npm run lint
npm run build
```

## Environment variables

See `.env.example`. Do not commit `.env.local` or real API credentials.

The map uses Google Places results. Google Places does not provide business email addresses; any email shown must come from a public business website. Google API quota and billing limits apply.

## Current limitations

- Search results and classification state are held in the current browser session; persistent user accounts and database-backed storage are not implemented.
- SMTP variables are examples only. Configure and verify a mail provider and a real delivery endpoint before using email outreach.
- The app does not discover or infer private email addresses.
