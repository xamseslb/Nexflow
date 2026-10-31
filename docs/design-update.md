# CRM interface update

The interface keeps Hub's green identity and existing React/FastAPI/Supabase architecture. The redesign prioritizes readable operational data, restrained surfaces, consistent navigation, and a dedicated login component rather than introducing another UI or authentication framework.

## Design direction

- Login: a focused, labeled form with password visibility, session restoration, localized errors, and a clearly separated fictional demo. No unsupported SSO, registration, or password-reset buttons.
- Desktop: a quieter sidebar, explicit current-page indication, consistent panel borders and spacing, stronger text contrast, and clearer table hierarchy.
- Mobile: a single-column login, touch-sized controls, readable input text, existing drawer navigation, and layouts checked for horizontal overflow on every workspace page.
- Overview, ring list, meetings, sales, and projects share the same typography and surface treatment. The login preview is explicitly labeled as fictional example data.

Attio (https://www.attio.com), HubSpot (https://www.hubspot.com), and Pipedrive (https://www.pipedrive.com) were selected as research candidates. All three official sites returned proxy policy denials in this environment. REA is mentioned in architecture.md but no REA tool or workflow is available in the repository/session. Consequently, this update does not claim to reproduce or verify their current designs.

## Behavior and backend

Supabase remains responsible for password authentication and session management. The frontend handles session restoration, localized failure states and logout cleanup; it does not store passwords. Mutation controls reflect project roles while the API remains the authority for authorization.

The API explicitly filters the project list to active memberships, returns a retryable 503 when the identity provider cannot be reached, and reports closed leads as ineligible for calling. JWT validation, transaction boundaries and RLS remain in place.

## Validation and limits

Run the TypeScript/production build, Python tests, desktop/mobile Playwright workflows and PWA checks documented in README.md. On the prepared cloud image, ignored frontend/.tmp Playwright configurations select system Chromium. New tests cover login interaction and navigation across all five workspace pages, identity-provider outages, and closed-lead eligibility.

Live Supabase login, migrations, RLS and concurrency require configured external services. They are not established by passing demo tests. The existing four PostgreSQL tests explicitly skip without a disposable TEST_DATABASE_URL.
