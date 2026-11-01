# Hub CRM

Mobil-først CRM for partnerhuben. React + TypeScript + Vite + Tailwind + shadcn/ui,
FastAPI + Pydantic + SQLAlchemy + Alembic, Supabase PostgreSQL + Auth + RLS.
Ingen Java-implementering og ingen alternativ database.

## Status

Første sammenhengende implementering, **ikke ferdig MVP eller klar for produksjon**.
Arbeidsflate med oversikt, prosjektbytte, søk, leadkort, ringetillatelse, samtalelogg,
møtebooking, enkel produktbasert salgsfordeling, ledergodkjenning og CSV-eksport.
Demonstrasjonen bruker kun fiktive data i minnet og utfører ingen anrop eller utsendinger.
Ekte bruk krever Supabase og migrering. Ingen auth-bypass eller lokal produksjonsdatabase.

Rapporter, diagrammer og oppfølgingskø er beskrevet i [rapporter og oppfølging](docs/reporting-and-follow-ups.md).

Se [krav og leveransestatus](docs/requirements.md) og [arkitektur](docs/architecture.md).

## Lokal start

Node 22.12+ (eller nyere kompatibel LTS) og Python 3.12 anbefales.

```powershell
npm.cmd ci --include=dev
npm.cmd run dev
```

Åpne http://127.0.0.1:8087 og velg **Åpne demonstrasjon**. Ingen nøkler er nødvendige.
Frontend bruker fast port 8087 og stopper hvis porten er opptatt.
Demoen nullstilles ved oppdatering eller prosjektbytte. Ikke skriv reelle personopplysninger i demoen.

Backend, fra prosjektroten:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend/requirements.lock
.\.venv\Scripts\python -m pip install --no-deps -e backend
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

Fyll inn egne verdier lokalt. Frontend får kun Supabase-URL og publishable key.
Backend bruker asymmetrisk Supabase-signering (ES256/RS256); ingen egen passorddatabase.

```powershell
cd backend
..\.venv\Scripts\python -m alembic upgrade head
..\.venv\Scripts\python -m uvicorn app.main:app --reload
```

API-dokumentasjon: http://127.0.0.1:8000/docs. Vite videresender `/api` til port 8000.
Arbeider startes fra `backend` med `python -m app.worker` etter at den separate rollen er konfigurert.

## Supabase og roller

Opprett et eget Supabase-utviklingsprosjekt i valgt EU/EØS-region. Kjør migreringen med
administrativ `MIGRATION_DATABASE_URL`. Den oppretter skjemaene `hub` / `hub_private`
og NOLOGIN-rollene `hub_api` / `hub_worker`. Ikke eksponer disse skjemaene i Data API.

Opprett deretter separate LOGIN-roller med sterke passord via sikker administrativ kanal:

```sql
CREATE ROLE hub_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT hub_api TO hub_runtime;
CREATE ROLE hub_jobs_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT hub_worker TO hub_jobs_runtime;
```

Sett passord sikkert uten å sjekke dem inn. `DATABASE_URL` skal bruke `hub_runtime`,
`WORKER_DATABASE_URL` skal bruke `hub_jobs_runtime`. Bruk Supabase-forbindelsen som
støtter disse rollene (direkte forbindelse eller passende session pooler), med TLS.
Ikke gi runtime-rollene medlemskap i postgres, service_role eller migreringsrollen.

Opprett brukere via Supabase Auth. Første partner, prosjekt, produkt og medlemskap legges
inn administrativt; selvbetjent onboarding er fase 3. Medlemskap refererer til `auth.users.id`.
`raw_user_meta_data.display_name` brukes kun som visningsnavn, aldri til autorisasjon.
Test minst to partnere og to prosjekter før ekte data tas inn.

## Kvalitetssikring

```powershell
npm run build
.\.venv\Scripts\python -m pytest backend/tests -q
npm run test:e2e
npm run test:pwa --workspace frontend
```

Playwright bruker installert Microsoft Edge på Windows. På Linux/CI brukes Chromium
med `PLAYWRIGHT_BROWSER=chromium` og `npx playwright install --with-deps chromium`.
Mobilprosjektet emulerer en mobilskjerm; det erstatter ikke prøving på en ekte iPhone.

PostgreSQL-integrasjonstester krever en **egen disponibel testdatabase** med migreringene
og `TEST_DATABASE_URL` satt til en administrativ tilkobling. Uten denne blir testene
eksplisitt hoppet over. De tester RLS og samtidighet; SQLite brukes ikke som erstatning.

Docker: `docker compose up --build`, med backend/.env og frontend-buildvariabler satt.
Supabase kjører eksternt. Compose starter ingen alternativ database. Migrering kjøres
separat, aldri automatisk av API-prosessen. Legg TLS/reverse proxy foran ved utrulling.

## Før produksjon

Fullfør kravlisten, kjør RLS- og samtidighetstester mot Supabase, gjennomgå juridiske regler,
sett opp registerleverandør, meldingsleverandør, kvitteringslagring, sikkerhetskopiering,
rate limiting, observabilitet og gjenopprettingstest. Ikke aktiver B2C eller utbetalinger
før tilhørende integrasjoner, dokumentasjon og tester er på plass.
