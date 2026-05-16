# 🔮 Pulse Analytics

Lightweight, privacy-first analytics platform. Drop a script tag, get insights.

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
