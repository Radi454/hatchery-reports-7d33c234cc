# Hatchery Insights dashboard

A read-only Arabic RTL dashboard for hatchery vaccination reports. It uses the approved Zoetis style, Supabase email/password and existing-account email-link authentication, and the `hatchery_dashboard_data` RPC. The browser contains only the public publishable key; authorization is enforced by the RPC and Supabase policies.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Run `npm ci` and `npm run dev`.
3. Sign in with an existing authorized account. This application has no sign-up path.

The page does not include snapshots or demo data. If configuration is absent, it shows a configuration message and does not fall back to fixtures.

## Data behavior

- The app requests pages from `hatchery_dashboard_data` with offsets until the RPC's `total` is loaded. A partial or failed page load is treated as an error; it never presents partial data as complete.
- Status defaults to accepted reports. Date, region, customer code, product, and status filters apply consistently to metrics, products, customers, charts, and recent reports.
- Overall bird totals count each report once. Per-product coverage counts that report once for each distinct recorded product and may overlap. Competitor entries show names only.
- Regional customer codes remain distinct. Unknown customer codes remain in bird and region totals but are excluded from active-customer counts and rankings.
- The original file is signed for 60 seconds only after the user opens a report. Excel-derived reports explain that an original file is unavailable.
- CSV export includes the complete filtered row set. The recent report table is paginated in the browser.

## Configuration and GitHub Pages

Set the repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` to the Supabase project URL and public publishable key. These are browser-visible public configuration values; never use a service-role key here. The Pages workflow builds at `/<repository-name>/` when the `main` branch is pushed or the workflow is manually run. GitHub Pages must be configured to use GitHub Actions.

For local preview, `VITE_BASE_PATH=/` serves from the site root. `VITE_BASE_PATH` may be set to another path for a different deployment target.

## Commands

- `npm test` — test report-grain aggregation, filters, customer-code identity, unknown customers, and durations.
- `npm run build` — create the production static site in `dist/`.
- `npm run dev` — run the local Vite server.

The existing-account email flow redirects to the deployed Pages URL, which is explicitly allowlisted in Supabase Auth. It does not create users or change the shared lab application’s default site URL. Email delivery uses the project’s existing email provider and rate limits.
