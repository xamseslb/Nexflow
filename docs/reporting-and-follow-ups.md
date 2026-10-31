# Rapporter og oppfølging

## Hva som er bygget

Rapportkurven kan bytte mellom leads, fullførte samtalelogger, møteregistreringer, salg og salgsverdi.

Egne sider for **Rapporter** og **Oppfølging**, et rapporterings-API, en prosjektisolert oppgavekø og en redigert aktivitetstidslinje på leadkortet. Eksisterende autentisering, transaksjoner og Supabase RLS brukes videre. Ingen nye produksjonsavhengigheter.

Rapporter er for `leader` og `admin`. Oppfølging og aktivitet er for `seller`, `booker`, `closer`, `leader` og `admin`. Partnerrollen får ingen av de nye endepunktene. API-et håndhever dette uavhengig av hvilke knapper som vises.

## API

Alle stier har prefikset `/api/v1/projects/{project_id}` og krever et gyldig Supabase-token.

| Metode | Sti | Formål |
|---|---|---|
| GET | `/reports?start=2026-10-01&end=2026-10-31&timezone=Europe/Oslo` | Måltall, daglig serie, pipeline, konvertering og boksplott |
| GET | `/follow-ups?status=open&overdue=false&limit=50&offset=0` | Oppgavekø, eventuelt med `lead_id` |
| POST | `/follow-ups` | Opprett egen oppgave på et åpent lead |
| PATCH | `/follow-ups/{task_id}` | Avslutt med `done` eller `cancelled` |
| GET | `/leads/{lead_id}/activity?limit=30&offset=0` | Tidslinje med handlingstype og tidspunkt |

Eksempel på oppretting (UUID-er erstattes med faktiske verdier):

```json
{
  "lead_id": "00000000-0000-0000-0000-000000000001",
  "title": "Følg opp tilbud",
  "note": "Avklar neste steg",
  "due_at": "2026-11-02T09:00:00+01:00",
  "idempotency_key": "00000000-0000-0000-0000-000000000002"
}
```

Oppgaven tildeles den verifiserte brukeren. En klient kan ikke oppgi et annet prosjekt, en partner eller en ansvarlig i kroppen. Nøkkelen må gjenbrukes ved nettverksretry av samme oppretting. Samme nøkkel med endret innhold gir 409. Gjentatt avslutning med samme status er idempotent; en allerede avsluttet oppgave kan ikke bytte sluttilstand. Det sendes ingen e-post eller push. Forfalte åpne oppgaver vises ved lesing av køen.

Køen returnerer `items`, `has_more`, `offset` og `truncated`. Sidestørrelsen er maksimalt 100 og offset maksimalt 10 000. Ved visningsgrensen signaliseres `truncated`; avgrens søket. Aktivitet har samme sidekontrakt. Tidslinjen returnerer aldri rå auditdetaljer, salgsfordeling, notater eller tokenopplysninger. Relaterte salg og oppgaver følger sine egne RLS-regler.

## Definisjoner for rapporter

Periodens start- og sluttdato er **inklusive lokale kalenderdatoer**. SQL bruker et halvt åpent UTC-intervall `[start, neste lokale midnatt etter slutt)`. Europe/Oslo er standard; døgn ved klokkeomstilling håndteres som 23/25 timer. Maksimum 366 kalenderdager. Uten datoer brukes de siste 30 dagene, inkludert dagens dato i valgt tidssone.

- `totals.leads`: leads opprettet i perioden.
- `totals.calls`: samtalelogger fullført i perioden (`completed_at`), inkludert «ikke svar». En autorisert telefonlenke alene teller ikke som en fullført samtale eller en besvart telefonsamtale.
- `totals.meetings`: møteposter opprettet i perioden, uavhengig av fremtidig møtedato. Dette er registreringer, ikke dokumentert oppmøte.
- `totals.sales` / `revenue_ore`: NOK-salg registrert i perioden og summen i heltallsøre, eks. mva. Venter-på-bekreftelse og ikke-godkjente salg er inkludert. Dette er ikke utbetalt provisjon eller regnskapsført inntekt.
- `series`: de samme definisjonene per lokal dato, med nuller for dager uten aktivitet. Summer beregnes i PostgreSQL, uavhengig av frontendens 500-raders lister.
- `pipeline`: **nåværende** leadstatus for hele prosjektet. Den beskriver ikke status ved en historisk sluttdato og er ikke en sekvensiell salgstrakt.
- `cohort`: leads opprettet i perioden og hvor mange av disse som har minst ett NOK-salg registrert før periodens slutt. Hvert lead teller én gang, og direkte salg uten møte er inkludert. Tom gruppe gir `null` konvertering, ikke en oppdiktet prosent.
- `distributions.sale_amount`: femtallssammendrag av periodens registrerte NOK-salg i øre.
- `distributions.hours_to_sale`: samme sammendrag av timer fra leadets oppretting til hver salgsregistrering i perioden. Negative tidsintervaller utelates.

Boksplottene bruker PostgreSQL `percentile_cont` med lineær interpolering. Endepunktene er **minimum og maksimum**, ikke Tukey-gjerder; det utføres ingen separat klassifisering av uteliggere. Minst fem observasjoner kreves for å vise et plott. Utvalgsstørrelsen vises alltid. Ørebeløpene i kvartilene kan være interpolerte; kun visning avrundes. Aggregeringen er prosjektbasert og viser ikke individuelle selgere.

## Demo

Rapportsiden viser et tydelig merket, deterministisk eksempel for oktober 2026. Det er ikke beregnet fra demoens lokale ringeliste. Kilden er `backend/scripts/generate_demo_report.py`, som bruker den samme rapportassembleren som backend. Generer på nytt fra prosjektroten med `.venv/bin/python backend/scripts/generate_demo_report.py`.

Demooppgaver ligger kun i komponentens minne og nullstilles når oppfølgingssiden forlates. Demoen skriver ingen journalposter; aktivitetshistorikken sier dette eksplisitt. Ingen database eller skjult suksess-stub benyttes.

## Databaseoppsett og kontroll i neste steg

Migrering **0002** legger til `hub.follow_ups`, sammensatte fremmednøkler, status-/idempotensbegrensninger, RLS og rapportindekser. Tidligere migrering 0001 er uendret. Ingen migrering er kjørt mot en faktisk database under denne leveransen.

1. Bruk den separate disponibel-testdatabaseflyten i README og CI, med `backend/tests/bootstrap_postgres.sql` før første migrering.
2. Fra `backend`: sett `MIGRATION_DATABASE_URL` gjennom sikker konfigurasjon og kjør `../.venv/bin/python -m alembic upgrade head` med administrativ migreringsrolle.
3. Kjør `.venv/bin/python -m pytest backend/tests -q` fra roten med `TEST_DATABASE_URL` til den migrerte disponible databasen. De syv PostgreSQL-testene skal da kjøre, ikke hoppe over. Nye tester dekker oppgaveisolasjon, samtidige idempotente opprettinger og faktisk PostgreSQL-rapportaggregering.
4. Koble API-et til den begrensede runtime-rollen og kontroller to prosjekter og to selgere. Kontroller rapporter som leder og avvisning som partner/selger. Bekreft at en selger ikke kan lese eller avslutte en annens oppgaver.

Kontroll uten database: Python-enhetstester, autentiseringskrav for API, TypeScript/produksjonsbygg, Playwright på desktop/mobil og offline-generering av hele migrerings-SQL-en. Dette verifiserer ikke kjørte migreringer, PostgreSQL-privilegier, RLS eller faktisk SQL-ytelse. Live API krever migrert database; dette må fullføres før reelle data tas i bruk.
