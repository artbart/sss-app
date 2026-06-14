# sss-app — Stuff So Sweet reader

User-facing reader app for personalized stories at https://app.stuffsosweet.com.

## Stack
- Vanilla HTML / CSS / JS (no build step)
- Supabase Auth (magic link, 24-hour TTL, 60-day persistent session)
- Supabase DB shared with the main marketing site (project `gmhbcxylqubhxozomhlt`)
- Hosted on GitHub Pages with custom domain `app.stuffsosweet.com`

## Pages (planned)
- `/` — sign-in form
- `/auth/callback.html` — magic-link token exchange
- `/stories.html` — list of user's stories
- `/story.html?id=X` — chapter list
- `/chapter.html?story=X&n=N` — chapter reader with option buttons
- `/settings.html` — notification preference + sign out

## Status
Phase 0 init in progress. Building incrementally.
