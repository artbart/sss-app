# sss-app — Stuff So Sweet reader

User-facing reader app at https://app.stuffsosweet.com.

## Stack
- Vanilla HTML / CSS / JS, no build step
- Supabase Auth (magic link, 24-hour TTL, 60-day persistent session)
- Supabase DB shared with marketing site (project `gmhbcxylqubhxozomhlt`)
- GitHub Pages, custom domain `app.stuffsosweet.com`

## Layout
```
/                            (this repo, served by GH Pages)
├── index.html               sign-in form
├── auth/callback.html       magic-link landing + token exchange
├── stories.html             list of user's stories (stub — Phase 3)
├── story.html               chapter list for one story (Phase 3)
├── chapter.html             chapter reader (Phase 3-4)
├── settings.html            notification preference + sign out (Phase 5)
├── assets/
│   ├── lib.js               Supabase client + auth helpers + analytics
│   └── style.css            shared brand styling
├── CNAME                    app.stuffsosweet.com
└── robots.txt
```

## Phase status
- Phase 0 ✓ Repo init, CNAME, DNS, GH Pages live
- Phase 0b ✓ Supabase Auth: Resend SMTP, redirect URLs, 24h magic link TTL
- Phase 1 ✓ DB migration: users + events tables, stories.user_id FK, RLS policies, auto-link triggers
- Phase 2 ← current — App skeleton: signin, auth callback, topbar, lib.js, style.css
- Phase 3 — Story list + chapter list + chapter reader
- Phase 4 — Realtime new-chapter delivery with 2-min cap
- Phase 5 — Notification preferences + email branching
- Phase 6 — PWA polish
- Phase 7 — Marketing site integration buttons
- Phase 8 — Settings, sign out, reading-position
- Phase 9 — In-app quiz (or iframe)
- Phase 10 — End-to-end verification
