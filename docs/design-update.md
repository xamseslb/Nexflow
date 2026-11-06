## Gjeldende design for Nexflow

Arbeidsflatene deler typografi, navigasjon og skjemaelementer. På stor skjerm ligger arbeidsområdene i en venstremeny. På mobil kan menyen åpnes med tastatur og lukkes med Escape. Hvit bakgrunn, mørk tekst, grønne handlinger og tabulære tall følger prinsippene i Vyros designsystem. Primærhandlingen på møtesiden starter en booking, mens salgssiden åpner en salgsregistrering. Begge starter med kontaktvalg.

Oversikten viser prosjektets nåværende tall. Hver statusrad åpner de tilsvarende kontaktene. I prosjektrapporten kan man velge periode, måltall og dato i kurven. Datotabellen gir de samme tallene i tekst. Bevegelse følger brukerens innstilling for redusert bevegelse.

Designreferansene er [Kokonut UI](https://kokonutui.com/), [Motion](https://motion.dev/docs/react-accessibility) og [Anime.js](https://animejs.com/documentation/svg/createdrawable/). Nexflow bruker CSS og SVG til tilbakemelding og diagrammer.

Playwright kjører arbeidsflytene i både desktop- og mobiloppsett. Navigasjon testes også ved 320 og 768 pikslers bredde. Autentisert innlogging, tilgangsendringer og vedlegg bruker isolerte testtjenester i nettlesertestene. PostgreSQL-testene sjekker de underliggende tilgangsreglene. Ekte Supabase-innlogging, lagring og telefonoverlevering inngår fortsatt i piloten.

## Tidligere designarbeid

# CRM interface update

The interface keeps Hub's green identity and existing React/FastAPI/Supabase architecture. The redesign prioritizes readable operational data, restrained surfaces, consistent navigation, and a dedicated login component rather than introducing another UI or authentication framework.

## Design direction

- Login: a focused, labeled form with password visibility, session restoration, localized errors, and a clearly separated fictional demo. No unsupported SSO, registration, or password-reset buttons.
- Desktop: a quieter sidebar, explicit current-page indication, consistent panel borders and spacing, stronger text contrast, and clearer table hierarchy.
- Mobile: a single-column login, touch-sized controls, readable input text, existing drawer navigation, and layouts checked for horizontal overflow on every workspace page.
- Overview, ring list, meetings, sales, and projects share the same typography and surface treatment. The login preview is explicitly labeled as fictional example data.

During the initial design pass, the environment blocked access to Attio, HubSpot and Pipedrive. The subsequent call queue and customer profile research is documented below.

## Behavior and backend

Supabase remains responsible for password authentication and session management. The frontend handles session restoration, localized failure states and logout cleanup; it does not store passwords. Mutation controls reflect project roles while the API remains the authority for authorization.

The API explicitly filters the project list to active memberships, returns a retryable 503 when the identity provider cannot be reached, and reports closed leads as ineligible for calling. JWT validation, transaction boundaries and RLS remain in place.

## Validation and limits

Run the TypeScript/production build, Python tests, desktop/mobile Playwright workflows and PWA checks documented in README.md. On the prepared cloud image, ignored frontend/.tmp Playwright configurations select system Chromium. New tests cover login interaction and navigation across all five workspace pages, identity-provider outages, and closed-lead eligibility.

The database suite uses a disposable PostgreSQL database to exercise migrations, RLS, reservations and concurrency. Hosted Supabase sign-in and Storage uploads still require a separate pilot with real user sessions.

## Design av ringeøkt og kundeprofil

HubSpots offentlige veiledning viser en arbeidskø med kategorivalg og en handling knyttet til aktiv kontakt. Pipedrive samler kontaktinformasjon, aktiviteter og relaterte oppføringer i kundens detaljvisning. I Nexflow ligger kontakt og historikk til venstre og samtaleutfall til høyre på desktop. På mobil følger de hverandre vertikalt. Selgeren velger selv når telefonen skal ringe.

* [HubSpot – prospecting queue](https://knowledge.hubspot.com/prospecting/use-the-prospecting-queue). Offentlig veiledning undersøkt i REA, evidens `ev_84e1cea4c75986b5d41addea8585e6e58c01eaf79801c7230daefd27647bb104`.
* [Pipedrive – contact detail view](https://support.pipedrive.com/en/article/contact-detail-view). Offentlig veiledning undersøkt i REA, evidens `ev_fa463e382e78b01971ac9a6847f96a7600de6e44924da60e671248cce0d0e8f4`.

Observasjonene gjelder de offentlige veiledningene. Komponenter, stilark og arbeidsflyt er utviklet i Nexflow-prosjektet.
