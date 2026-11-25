# IBAYSOFT

IBAYSOFT is a Turkish-language business discovery dashboard built with Next.js, React, TypeScript, Tailwind CSS, and Google Maps JavaScript/Places APIs.

## Requirements

- Node.js 20.19+ or 22 LTS
- npm
- Maps JavaScript API, Places API (New), and Geocoding API enabled in a Google Cloud project
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

For SMTP, enter your provider's server in `SMTP_HOST`, its port in `SMTP_PORT` (`587` with `SMTP_SECURE=false`, or `465` with `SMTP_SECURE=true`), the full login email in `SMTP_USER`, its SMTP password/app password in `SMTP_PASS`, and a verified sender address in `SMTP_FROM`. For Gmail, use `smtp.gmail.com` and a Google App Password (requires 2-Step Verification), not your normal Google password. Restart the dev server after editing `.env.local`.

The map uses Google Places results. Google Places does not provide business email addresses; any email shown must come from a public business website. Google API quota and billing limits apply.

Each map search uses Google Places Nearby Search with business types and overlapping circular areas. The selected radius is split into 3x3 to 7x7 regions (25 requests for a 5 km search); each request can return at most 20 results. Results are merged by Place ID and filtered against the original radius. If the Nearby Search daily quota is exhausted, the app falls back to up to eight category-based text searches (at most 20 results each). This improves coverage over a single broad text query, but Google may still limit results in exceptionally dense areas. Search requests use Google Places quota and billing.

After a search, the app requests each result's website and phone fields from Places. For results with a website, the local enrichment endpoint checks that public site and up to twelve same-site pages, prioritizing contact links discovered on the business website and also trying common Turkish and English contact URLs when the homepage has no email. If no email is found, it may check one Facebook and one Instagram public profile linked from the official website, without signing in and only when allowed by the platform's robots.txt. It only returns explicitly published email addresses, is limited to four businesses per request, public IP addresses, and robots.txt rules. Google Places does not provide an email field for business profiles. The app does not search the wider web or infer addresses, so an address may remain unavailable even for a large company.

The scan UI distinguishes a completed scan with no published address from a blocked/inaccessible site. Missing common contact URLs (404/410) are normal and do not make a scan incomplete; sites that do not allow robots.txt checks are not crawled.

Businesses and search history are stored in the local SQLite database at `.data/workspace.db`. Starting the development or production server generates the Prisma client and synchronizes the schema. The İşletmelerim page stores status, follow-up date, notes, and optional consent source/date. CSV export includes saved business and tracking fields; JSON backup includes saved businesses and searches. Restoring a backup merges records and keeps existing records when IDs conflict.

Chain labels are indicative only: known brand names and repeated normalized names in the current search results are marked as likely chain results. The displayed result count is not the brand's total branch count. Other businesses are labeled as having an unknown branch status, not as independent.

Review Google Maps Platform terms before using Places-derived business listings for outreach or storing them beyond the current session. Use public contact details only for communications you are legally permitted to send.

## Current limitations

- The SQLite database is local to this machine and ignored by Git. It is not shared across devices and has no user accounts.
- CSV/JSON workspace exports are manual backups. Keep backup files private; they contain business contact details, notes, follow-up dates, and optional consent records. Email templates and per-recipient SMTP attempt history are not included in workspace backups.
- Email templates and per-recipient SMTP attempt history are stored locally in `.data/email-store.json`, which is ignored by Git. Back up this file if you need to preserve local history.
- SMTP sending uses the configured provider and sends one personalized message per recipient, at most 30 per batch. The API requires same-origin requests, loopback access, explicit commercial-message permission confirmation, validates recipients, and suppresses repeat sends to an address for seven days.
- SMTP `sent` status means the SMTP server accepted the message; it is not proof of inbox delivery. Gmail quotas, provider policies, KVKK/6563 and İYS obligations still apply.
- Email history and sending are restricted to localhost until authentication and persistent shared storage are implemented. Do not expose this unauthenticated build publicly with SMTP credentials enabled.
- The app does not discover or infer private email addresses.
- The app only checks the public website returned by Places; it does not crawl search engines, social networks, directories, or unrelated third-party sources.
