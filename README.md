# Pulse Analytics

**Working product demo — lightweight, privacy-conscious web analytics with live operational visibility.**

Pulse Analytics lets a site owner create a project, install a small tracking script, collect events, and inspect live and historical usage through a dashboard. The architecture separates live event handling from historical analytics so the product can remain responsive as data grows.

## Product workflow

```text
Create project → install tracking script → collect validated events → buffer live activity → persist history → inspect dashboard → export or investigate a trend
```

The key product concerns are event validation, project isolation, freshness indicators, aggregation correctness, tracker resilience, and clear privacy boundaries. The tracker should fail safely when the network is unavailable and must not silently collect data outside the configured project.

## Verification status

- **Implemented product surface:** project/auth flows, event collection, Redis live path, PostgreSQL history, dashboard endpoints, and lightweight tracker script.
- **Founder-demo ready:** create a project, install the script on a sample page, generate events, show live activity, then inspect historical page/referrer/device views.
- **Before production use:** add automated event-schema and aggregation tests, enforce rate limits and payload limits on collection, document retention/deletion controls, verify project authorization on every analytics query, and complete a privacy review.

## Demo walkthrough

1. Create a project and copy its tracker snippet.
2. Install the snippet on a sample page.
3. Generate pageview and interaction events.
4. Show live activity and historical aggregation.
5. Send an invalid or oversized payload and show the safe rejection path.
6. Explain the privacy and retention decisions.

## Quick Start

```bash
# Install
npm install

# Set up env
cp .env.example .env
# Edit .env with your PostgreSQL + Redis URLs

# Push database schema
npm run db:push

# Run dev server (API)
npm run dev

# Run frontend (separate terminal)
npx vite
```

## Architecture

```
User's Website → <script src="/t.js" data-id="proj_xxx">
                        ↓
              POST /api/collect (events)
                        ↓
         ┌──────────────┼──────────────┐
         ↓              ↓              ↓
    Redis (live)   Event Buffer   PostgreSQL
                                  (historical)
                        ↓
              Dashboard (React)
              /api/analytics/*
```

## Deploy to Railway

1. Push to GitHub
2. Connect repo in Railway
3. Add PostgreSQL + Redis addons
4. Set environment variables
5. Deploy

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | No | Create account |
| POST | /api/auth/login | No | Sign in |
| POST | /api/auth/refresh | No | Refresh token |
| POST | /api/collect | No | Receive events (tracker) |
| GET | /api/projects | Yes | List projects |
| POST | /api/projects | Yes | Create project |
| GET | /api/analytics/:id/overview | Yes | Overview stats |
| GET | /api/analytics/:id/pages | Yes | Top pages |
| GET | /api/analytics/:id/referrers | Yes | Top referrers |
| GET | /api/analytics/:id/devices | Yes | Device breakdown |
| GET | /api/analytics/:id/live | Yes | Live visitor count |

## Tracker Script

```html
<script src="https://your-domain.com/t.js" data-id="your_project_id"></script>
```

Auto-tracks: pageviews, unique visitors, sessions, scroll depth, time on page, clicks, referrers, UTM params, device/browser/country.
