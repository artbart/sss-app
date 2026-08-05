// Stuff So Sweet app — shared library.
// Imported as an ES module from each page. Initializes the Supabase client,
// exposes auth helpers, and provides a small event-logging utility.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import posthog from "https://esm.sh/posthog-js@1";

const SUPABASE_URL = "https://gmhbcxylqubhxozomhlt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtaGJjeHlscXViaHhvem9taGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTk5OTksImV4cCI6MjA5MjczNTk5OX0.GAM73P5X7fT1BIziTfvqUpFT2W_W5EtFb5Gze5cIFfY";

/**
 * Cross-subdomain cookie storage: writes Supabase session cookies on the parent
 * domain .stuffsosweet.com so app.stuffsosweet.com and chat.stuffsosweet.com share
 * the same session. Falls back to localStorage on localhost / preview environments.
 *
 * Cookies are stored URL-encoded. The Supabase session payload (~2-4KB) fits in a
 * single cookie under the 4KB limit; if a future user has a larger session we will
 * need to split across multiple cookies.
 */
const PARENT_DOMAIN = ".stuffsosweet.com";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const isProductionHost = typeof location !== "undefined" && location.hostname.endsWith("stuffsosweet.com");
const crossDomainCookieStorage = {
  getItem(key) {
    if (typeof document === "undefined") return null;
    const prefix = encodeURIComponent(key) + "=";
    const parts = document.cookie ? document.cookie.split("; ") : [];
    for (const part of parts) {
      if (part.startsWith(prefix)) {
        try { return decodeURIComponent(part.slice(prefix.length)); }
        catch (_) { return part.slice(prefix.length); }
      }
    }
    return null;
  },
  setItem(key, value) {
    if (typeof document === "undefined") return;
    const cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; domain=${PARENT_DOMAIN}; SameSite=Lax; Secure; max-age=${COOKIE_MAX_AGE_SECONDS}`;
    document.cookie = cookie;
  },
  removeItem(key) {
    if (typeof document === "undefined") return;
    document.cookie = `${encodeURIComponent(key)}=; path=/; domain=${PARENT_DOMAIN}; max-age=0`;
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: isProductionHost ? crossDomainCookieStorage : (typeof window !== "undefined" ? window.localStorage : undefined),
  },
});

/* ===== PostHog product analytics =====
 * The project key below is a PUBLIC (publishable) PostHog key — it is meant to
 * live in client-side code, exactly like the Supabase anon key above.
 * Both stuffsosweet.com and app.stuffsosweet.com report into the SAME PostHog
 * project, so this key must match the one used in Sss_test/assets/posthog.js.
 *
 * EU cloud: ingestion host eu.i.posthog.com, dashboard host eu.posthog.com.  */
const POSTHOG_KEY = "phc_BzHnof4mQ7dmxTetogNVJF4aEynfmgDP4uHs5LBQZrFu";
const POSTHOG_HOST = "https://eu.i.posthog.com";

// Only initialize once we have a real key, so the app keeps working before the
// project is created / the key is pasted in.
export const posthogReady = POSTHOG_KEY.startsWith("phc_") && !POSTHOG_KEY.includes("REPLACE");
if (posthogReady) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: "https://eu.posthog.com",
    person_profiles: "identified_only", // anonymous events still captured & merged on identify
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    session_recording: {
      maskAllInputs: true, // mask every form input (emails, etc.) in replays
    },
    persistence: "localStorage+cookie",
  });
} else {
  console.warn("[sss-app] PostHog key not set — analytics disabled. Paste the project key into assets/lib.js.");
}

export { posthog };

/* ===== Auth helpers ===== */

// Request a magic link to the given email.
// Returns { ok: true } on send, { ok: false, error } on failure.
export async function requestMagicLink(email) {
  const cleaned = (email || "").trim().toLowerCase();
  if (!cleaned || !cleaned.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: cleaned,
    options: {
      emailRedirectTo: "https://app.stuffsosweet.com/auth/callback",
      shouldCreateUser: true,  // allow brand-new accounts to be created
    },
  });
  if (error) {
    console.error("[sss-app] signInWithOtp failed:", error);
    return { ok: false, error: error.message || "Couldn't send the link. Try again." };
  }
  await logEvent("magic_link_requested", { email: cleaned });
  return { ok: true };
}

// Sign in with email + password. Optional path alongside magic-link auth —
// users who've set a password in settings can skip the email round-trip.
// Returns { ok: true, session } on success, { ok: false, error } on failure.
export async function signInWithPassword(email, password) {
  const cleaned = (email || "").trim().toLowerCase();
  if (!cleaned || !cleaned.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleaned,
    password,
  });
  if (error) {
    console.error("[sss-app] signInWithPassword failed:", error);
    // Supabase's default 'Invalid login credentials' is user-friendly enough.
    return { ok: false, error: error.message || "Invalid email or password." };
  }
  try { await logEvent("password_signin", { email: cleaned }); } catch (_) {}
  return { ok: true, session: data.session };
}

// Set (or change) the current user's password. Requires an active session —
// call this from settings.html, not from the sign-in page. Supabase's minimum
// password length is 6; the check here mirrors that so we fail fast with a
// clean error instead of sending the RPC and reading a cryptic response.
export async function setPassword(newPassword) {
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    console.error("[sss-app] setPassword failed:", error);
    return { ok: false, error: error.message || "Couldn't set password. Try again." };
  }
  try { await logEvent("password_set"); } catch (_) {}
  return { ok: true };
}

// Fetch the current session (or null).
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

// Sign the user out and redirect to the app's sign-in page.
// Always uses an absolute URL so relative-path interpretation can't bounce
// the user to the marketing site if the call happens from a weird state.
export async function signOut(redirect = "https://stuffsosweet.com/") {
  // Fire-and-forget the analytics ping so a slow/failed POST can't block logout
  try { logEvent("logout"); } catch (_) {}
  // Clear the Supabase session — but never let a failure here trap the user
  try { await supabase.auth.signOut(); } catch (e) { console.warn("[signOut] supabase.auth.signOut threw, continuing anyway:", e); }
  // Default destination is the public marketing site (stuffsosweet.com), NOT
  // app.stuffsosweet.com — the marketing site is the friendlier post-logout surface
  // (shows brand + value prop + quiz CTA) vs. the app's empty sign-in form.
  const target = redirect.startsWith("http") ? redirect : `https://stuffsosweet.com${redirect}`;
  console.info("[signOut] redirecting to", target);
  // .replace() instead of .href so the just-signed-out page doesn't end up in back history
  window.location.replace(target);
}

// Page guard: redirect to / if not logged in.
// Use at the top of any protected page.
export async function requireAuth() {
  const sess = await getSession();
  if (!sess) {
    window.location.href = "/?next=" + encodeURIComponent(location.pathname + location.search);
    throw new Error("not authenticated");
  }
  return sess;
}

// Page guard for the signin page: if already logged in, bounce to stories.
export async function redirectIfAuthenticated(target = "/stories.html") {
  const sess = await getSession();
  if (sess) {
    window.location.href = target;
    throw new Error("already authenticated");
  }
}

/* ===== Analytics ===== */

// Log a lightweight event. Fires-and-forgets. Never throws.
// user_id is auto-populated from the session if present.
export async function logEvent(event_type, extras = {}) {
  try {
    const sess = await getSession();
    const row = {
      event_type,
      user_id: sess?.user?.id ?? null,
      email: extras.email ?? sess?.user?.email ?? null,
      session_id: extras.session_id ?? null,
      story_id: extras.story_id ?? null,
      chapter_number: extras.chapter_number ?? null,
      metadata: extras.metadata ?? null,
    };
    const { error } = await supabase.from("events").insert(row);
    if (error) console.warn("[sss-app] event insert failed:", error.message);

    // Mirror the same event to PostHog. Flatten the well-known columns and
    // spread metadata so each key is a first-class, filterable property.
    if (posthogReady) {
      const { metadata, email, ...rest } = extras;
      posthog.capture(event_type, {
        ...rest,
        ...(metadata && typeof metadata === "object" ? metadata : { metadata }),
        story_id: row.story_id ?? undefined,
        chapter_number: row.chapter_number ?? undefined,
        session_id: row.session_id ?? undefined,
        surface: "app",
      });
    }
  } catch (e) {
    console.warn("[sss-app] logEvent threw:", e);
  }
}

/* Tie the current PostHog person to the signed-in Supabase user.
 * Called automatically on load (below) and again right after login. Idempotent. */
export async function identifyUser(session = null) {
  if (!posthogReady) return;
  try {
    const sess = session ?? (await getSession());
    if (sess?.user?.id) {
      // Key identity on EMAIL to match the marketing/quiz funnel (Sss_test),
      // so a visitor's quiz → signup → reading journey is one PostHog person.
      // The Supabase UUID is kept as a property for cross-referencing.
      posthog.identify(sess.user.email ?? sess.user.id, {
        email: sess.user.email ?? undefined,
        supabase_user_id: sess.user.id,
      });
    }
  } catch (e) {
    console.warn("[sss-app] identifyUser threw:", e);
  }
}

// Identify on every page load if a session already exists, and keep PostHog in
// sync with Supabase auth transitions (login in another tab, token refresh, logout).
if (posthogReady) {
  identifyUser();
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") identifyUser(session);
    if (event === "SIGNED_OUT") posthog.reset();
  });
}

/* ===== Cross-subdomain chat link ===== */
// Build a URL to chat.stuffsosweet.com that carries the current Supabase session
// in the URL hash so chat auto-logs the user in (detectSessionInUrl=true on that side).
//   buildChatUrl()                → opens the chat home (wizard / past convos)
//   buildChatUrl(storyId)         → opens the wizard pre-selected to that personalized story
export async function buildChatUrl(target = null) {
  // Accepts: null (just chat home), a string (legacy = story uuid),
  // { story: <uuid> } for personalized stories, { book: <slug> } for library books.
  // Session is shared across subdomains via cookies on .stuffsosweet.com, so no
  // URL hash passthrough is needed in normal cases. Hash fallback kept in case the
  // user has cookies blocked.
  if (typeof target === "string") target = { story: target };
  const base = "https://chat.stuffsosweet.com/";
  let query = "";
  if (target?.story) query = `?story=${encodeURIComponent(target.story)}`;
  else if (target?.book) query = `?book=${encodeURIComponent(target.book)}`;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token && session?.refresh_token) {
      // Hash fallback: chat-side bootstrap calls setSession() with these if present.
      // Harmless if cookies already carried the session.
      const hash = `#access_token=${encodeURIComponent(session.access_token)}` +
                   `&refresh_token=${encodeURIComponent(session.refresh_token)}` +
                   `&token_type=bearer&type=magiclink`;
      return base + query + hash;
    }
  } catch (e) {
    console.warn("[chat-passthrough] could not read session:", e);
  }
  return base + query;
}

/* ===== UI helpers ===== */

// Inject a standard top-bar into the page.
// Renders into the first element matching `#topbar`.
export function renderTopbar(target = "#topbar") {
  const el = document.querySelector(target);
  if (!el) return;
  el.innerHTML = `
    <div class="topbar">
      <a class="brand" href="/stories.html">SSS</a>
      <div class="menu">
        <a href="/stories.html">Stories</a>
        <a href="/library/">Library</a>
        <a href="#" id="chatNavLink">Chat</a>
        <a href="/settings.html">Settings</a>
        <button id="signOutBtn" type="button">Sign out</button>
      </div>
    </div>
  `;
  document.getElementById("signOutBtn")?.addEventListener("click", () => signOut("/"));
  document.getElementById("chatNavLink")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const url = await buildChatUrl();
    window.open(url, "_blank", "noopener");
  });
}

/* ===== Preview mode (localhost-only mock data) =====
 * Every rebuilt page (story, chapter, library, settings, book) can pass its
 * own mock data set and be walkable locally with `?preview=1` — no auth, no
 * real DB, no risk of leaking (gated by hostname).
 *
 * Usage inside a page:
 *   const session = await getSessionOrPreview({
 *     users:   [{ display_name: "Arturas" }],
 *     stories: [{ id, title, ...}, ...],
 *     chapters: [...],
 *   });
 *
 * On localhost with ?preview=1 → installs mock supabase.from() and returns
 * a fake session. Otherwise → returns real requireAuth() result unchanged.
 * ?preview=1 propagates through <a> clicks so the whole app is walkable. */
export function isPreviewMode() {
  if (typeof location === "undefined") return false;
  const local = ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname);
  return local && new URLSearchParams(location.search).has("preview");
}
export function installMockSupabase(mocks) {
  supabase.from = (table) => {
    const rows = (mocks && mocks[table]) || [];
    const q = {
      _rows: rows,
      _countMode: false,
      select(cols, opts) {
        if (opts && opts.count === "exact" && opts.head) q._countMode = true;
        return q;
      },
      eq() { return q; },
      neq() { return q; },
      gte() { return q; },
      lte() { return q; },
      order() { return q; },
      limit(n) { q._rows = q._rows.slice(0, n); return q; },
      single() { return Promise.resolve({ data: q._rows[0] || null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: q._rows[0] || null, error: null }); },
      then(resolve) {
        if (q._countMode) resolve({ count: q._rows.length, error: null });
        else resolve({ data: q._rows, error: null });
      },
    };
    return q;
  };
  // Neutralize functions.invoke + realtime channel so nothing hits real DB.
  // supabase.functions is a lazy getter — assigning to it throws. We assign
  // to the invoke method on the returned object instead, wrapped in try/catch
  // because some SDK versions freeze it.
  try { supabase.functions.invoke = async () => ({ data: { ok: true }, error: null }); } catch (_) {}
  try {
    supabase.channel = () => ({ on() { return this; }, subscribe() { return this; } });
    supabase.removeChannel = () => {};
  } catch (_) {}
  console.info("[preview] mock supabase installed for tables:", Object.keys(mocks || {}));
}
export async function getSessionOrPreview(mocks) {
  if (isPreviewMode()) {
    installMockSupabase(mocks || {});
    // Propagate ?preview=1 to any relative <a> the page renders so links stay
    // in preview mode across navigation.
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (!a) return;
      const url = a.getAttribute("href");
      if (!url || url.startsWith("http") || url.startsWith("#") || url.startsWith("mailto:")) return;
      if (url.includes("preview=")) return;
      e.preventDefault();
      const sep = url.includes("?") ? "&" : "?";
      window.location.href = url + sep + "preview=1";
    }, true);
    return { user: { id: "preview-user", email: "arturas@stuffsosweet.com" } };
  }
  return await requireAuth();
}

/* ===== App shell (rail + mobile header + bottom nav) =====
 * Newer helper that replaces renderTopbar() on redesigned pages.
 * Injects the desktop left rail, the mobile-only top header, and the mobile
 * bottom nav. Pages call this once after requireAuth().
 *
 *   renderShell({ activeNav: "home" | "chat" | "library" | "settings",
 *                 mountRail: "#shell-rail",           // where to inject rail
 *                 mountMobileHeader: "#shell-mheader",// where to inject m-header
 *                 mountBottomNav: "#shell-bnav" })    // where to inject bottom-nav
 *
 * All mount points optional — helper looks for the standard ids if not given.
 * User avatar/name populated async from session + public.users.display_name.
 * "Chat" links go through buildChatUrl() so the SSO passthrough works.
 * Shell CSS lives at /assets/app-shell.css — page must include it.
 */
export async function renderShell(opts = {}) {
  const active = opts.activeNav || "home";
  const railEl = document.querySelector(opts.mountRail || "#shell-rail");
  const mhEl   = document.querySelector(opts.mountMobileHeader || "#shell-mheader");
  const bnEl   = document.querySelector(opts.mountBottomNav || "#shell-bnav");

  // Detect static shell markup baked into the page (preferred — prevents the
  // layout flash where the rail is briefly empty before JS finishes). If the
  // rail already has nav items, we skip re-rendering markup and just:
  //   1. Mark the active nav item (in case the static HTML wasn't specific to this page)
  //   2. Wire chat click handlers
  //   3. Fill in the user avatar/name asynchronously
  const railHasContent = railEl && railEl.querySelector(".rail-nav a");
  const bnHasContent   = bnEl && bnEl.querySelector(".bn-item");

  if (!railHasContent && railEl) {
    // Legacy path — page didn't include static markup. Render it now.
    const railItems = [
      { key: "home",     href: "/stories.html",  ico: "🏠", label: "Home" },
      { key: "new",      href: "/quiz2.html",    ico: "✎",  label: "New story" },
      { key: "chat",     href: "#chat",          ico: "💬", label: "Chat" },
      { key: "library",  href: "/library/",      ico: "📚", label: "Library" },
      { key: "settings", href: "/settings.html", ico: "⚙️", label: "Settings" },
    ];
    const items = railItems.map(i =>
      `<a href="${i.href}" class="${i.key === active ? "active" : ""}" data-nav="${i.key}">
        <span class="n-ico">${i.ico}</span> ${i.label}
      </a>`).join("");
    railEl.outerHTML = `<aside class="rail" id="shell-rail">
      <a href="/stories.html" class="rail-brand">Stuff So <span>Sweet</span></a>
      <nav class="rail-nav">${items}</nav>
      <a class="rail-user" href="/settings.html" title="Account settings">
        <div class="u-av" id="railAv">…</div>
        <div class="u-name" id="railName">…</div>
      </a>
    </aside>`;
  }
  if (!mhEl?.querySelector(".m-brand") && mhEl) {
    mhEl.outerHTML = `<header class="m-header" id="shell-mheader">
      <a href="/stories.html" class="m-brand">Stuff So <span>Sweet</span></a>
    </header>`;
  }
  if (!bnHasContent && bnEl) {
    const bnItems = [
      { key: "home",    href: "/stories.html",  ico: "🏠", label: "Home" },
      { key: "library", href: "/library/",      ico: "📚", label: "Library" },
      { key: "chat",    href: "#chat",          ico: "💬", label: "Chat" },
      { key: "settings",href: "/settings.html", ico: "👤", label: "You" },
    ];
    const items = bnItems.map(i =>
      `<a href="${i.href}" class="bn-item ${i.key === active ? "active" : ""}" data-nav="${i.key}">
        <span class="bn-ico">${i.ico}</span>${i.label}
      </a>`).join("");
    bnEl.outerHTML = `<nav class="bottom-nav" id="shell-bnav">${items}</nav>`;
  }

  // Ensure the correct nav item is marked active regardless of static/dynamic
  document.querySelectorAll(".rail-nav a, .bn-item").forEach(a => {
    if (a.dataset.nav === active) a.classList.add("active");
    else a.classList.remove("active");
  });

  // Inject a permanent "Buy story pack" item at the bottom of the rail nav.
  // Every page has its own static rail markup (to prevent layout flash), so
  // rather than editing all of them, we add this one via JS on shell render.
  // Skipped when it's already present (idempotent on multi-render). Click
  // opens the modal on stories.html or routes there with ?openpack=1.
  const rNav = document.querySelector(".rail-nav");
  if (rNav && !rNav.querySelector('[data-action="buy-pack"]')) {
    const a = document.createElement("a");
    a.href = "/stories.html?openpack=1";
    a.dataset.action = "buy-pack";
    a.title = "One-time $4.99 · adds 3 stories · credits never expire";
    a.innerHTML = `<span class="n-ico">🎟️</span> Buy story pack`;
    a.style.marginTop = "8px";
    a.style.opacity = "0.85";
    a.addEventListener("click", (e) => {
      // If we're already on a page that hosts the modal, open it inline.
      if (window.__sssPackModalRendered) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sss:open-pack-modal"));
      }
      // else fall through to /stories.html?openpack=1 which auto-opens
    });
    rNav.appendChild(a);
  }

  // Wire the "Chat" links to buildChatUrl() so cross-subdomain SSO works.
  document.querySelectorAll('[data-nav="chat"]').forEach(a => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = await buildChatUrl();
      window.location.href = url;
    });
  });

  // Gate the rail "New story" link when the monthly quota (3 stories) is
  // exhausted. Runs on every page so users can't sneak past by navigating
  // to /quiz2.html from settings or story pages. Silent-fail if the query
  // can't run (e.g. preview mode, guest session) — better to allow than
  // to block wrongly.
  gateNewStoryNav().catch((e) => console.warn("[shell] quota gate failed:", e));

  // Reveal main content — starts hidden via .main{opacity:0} so pages don't
  // flash empty → filled during load. One frame after the shell is set up
  // is enough for layout to settle.
  requestAnimationFrame(() => {
    document.querySelectorAll("main.main").forEach(m => m.classList.add("ready"));
  });

  // Fill in user's initial + display name in the rail (async, non-blocking).
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const email = session.user.email || "";
      let name = email.split("@")[0].split("+")[0] || "there";
      name = name.charAt(0).toUpperCase() + name.slice(1);
      try {
        const { data: u } = await supabase.from("users")
          .select("display_name").eq("id", session.user.id).maybeSingle();
        if (u?.display_name) name = u.display_name;
      } catch (_) {}
      const av = document.getElementById("railAv");
      const nm = document.getElementById("railName");
      if (av) av.textContent = name.charAt(0).toUpperCase();
      if (nm) nm.textContent = name;
    }
  } catch (e) { /* rail user row is decorative — swallow */ }
}

/* ===== New-story quota gate (shared across every page's rail nav) =====
 * Queries this month's story count; if the user is at the plan's monthly
 * cap, dims the "New story" nav item + intercepts clicks with a tooltip.
 * Only touches the rail nav item; the header pill on stories.html has its
 * own gate. Backend enforcement lives in start-authenticated-story-v2. */

/* Monthly story quota per plan tier. Mirrors storyLimitFor() in
 * supabase/functions/_shared/access.ts — keep the two in sync. This is a
 * display hint only; the server enforces the real limit. Unknown/missing
 * tiers fall back to the standard limit (never the tighter lite limit) so
 * a bad value can't lock out a paying user.
 * EXPORTED because stories.html builds its shell inline and therefore runs
 * its own quota widget (loadQuota) instead of gateNewStoryNav below — both
 * must derive the limit from the same table or the home page will disagree
 * with Settings and story.html for a `lite` user. */
const STORY_LIMITS = { standard: 3, lite: 1 };
export function storyLimitFor(planTier) { return STORY_LIMITS[planTier] ?? STORY_LIMITS.standard; }

// ─── Chapter ratings ────────────────────────────────────────────────
// One-shot per user per chapter (1-10 stars + optional text). No updates
// allowed by the DB — the widget hides itself after first submit.
//
// getChapterRating(chapterId) → { rating: {stars, feedback_text, created_at} | null, error? }
// saveChapterRating(chapterId, {story_id, chapter_number, stars, feedback_text?})
//    → { ok: true, rating } on success
//    → { ok: false, alreadyRated: true } if a rating already exists (unique violation)
//    → { ok: false, error: message } for any other failure
export async function getChapterRating(chapterId) {
  if (!chapterId) return { rating: null };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return { rating: null };
    const { data, error } = await supabase.from("chapter_ratings")
      .select("stars, feedback_text, created_at")
      .eq("chapter_id", chapterId)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) return { rating: null, error: error.message };
    return { rating: data || null };
  } catch (e) {
    return { rating: null, error: e?.message || "load failed" };
  }
}

// Sanitize user-supplied feedback text before persisting.
// Same principle as the quiz2 hardening: this text may later feed a
// report artifact or (if we ever wire it in) a generation prompt. Strip
// HTML tags, strip control characters except regular whitespace, collapse
// runaway whitespace, and cap length. Purely defensive — the DB accepts
// anything.
function sanitizeFeedbackText(raw) {
  if (raw == null) return null;
  let s = String(raw);
  // Drop HTML/XML tags — trivial XSS defense for any future rendering
  s = s.replace(/<[^>]*>/g, "");
  // Drop control chars (keep \t \n \r); zero-width/BOM chars too
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  s = s.replace(/[​-‍﻿]/g, "");
  // Collapse runaway whitespace (>3 blank lines / >20 spaces in a row)
  s = s.replace(/\n{4,}/g, "\n\n\n");
  s = s.replace(/ {20,}/g, "                    ");
  s = s.trim();
  if (s.length > 2000) s = s.slice(0, 2000);
  return s.length ? s : null;
}

export async function saveChapterRating(chapterId, { story_id, chapter_number, stars, feedback_text } = {}) {
  if (!chapterId) return { ok: false, error: "missing chapter id" };
  if (!Number.isInteger(stars) || stars < 1 || stars > 10) {
    return { ok: false, error: "stars must be 1-10" };
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return { ok: false, error: "not signed in" };
    const payload = {
      chapter_id:     chapterId,
      user_id:        session.user.id,
      story_id,
      chapter_number,
      stars,
      feedback_text:  sanitizeFeedbackText(feedback_text),
    };
    const { data, error } = await supabase.from("chapter_ratings")
      .insert(payload).select("stars, feedback_text, created_at").single();
    if (error) {
      // Postgres unique_violation → already rated (defensive; UI shouldn't call twice)
      if (error.code === "23505") return { ok: false, alreadyRated: true };
      return { ok: false, error: error.message };
    }
    return { ok: true, rating: data };
  } catch (e) {
    return { ok: false, error: e?.message || "save failed" };
  }
}

async function gateNewStoryNav() {
  const navItems = document.querySelectorAll('[data-nav="new"]');
  if (!navItems.length) return;                    // no new-story link on this page
  if (isPreviewMode()) return;                     // preview mode has no real quota
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;                      // signed out — no gate

  // Lifetime affects access, not quota; extra_story_credits stack on top of
  // the monthly limit and don't reset. Total quota = base + credits.
  const { data: prof } = await supabase.from("users")
    .select("plan_tier, lifetime_at, extra_story_credits").eq("id", session.user.id).maybeSingle();
  const limit = storyLimitFor(prof?.plan_tier);
  const credits = Number(prof?.extra_story_credits ?? 0) || 0;
  const total = limit + credits;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count, error } = await supabase.from("stories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.user.id)
    .gte("created_at", monthStart);
  if (error) return;                               // silent fail — better to allow

  const used = count || 0;
  const blocked = used >= total;

  // Display format: used/total (e.g. 0/3, 3/6, 3/9). No "extra" wording — one
  // number tells the user what matters: can I write another story right now?
  navItems.forEach((a) => {
    let hint = a.querySelector('.n-quota');
    if (!hint) {
      hint = document.createElement('span');
      hint.className = 'n-quota';
      a.appendChild(hint);
    }
    hint.textContent = ` · ${used}/${total}`;
    if (blocked) {
      a.setAttribute("data-quota-blocked", "1");
      a.setAttribute("title",
        `You've used all your stories (${used}/${total}). Buy a pack or wait for the monthly reset.`);
      // Reroute click to open the pack modal instead of following /quiz2.html
      a.addEventListener("click", (e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sss:open-pack-modal"));
        setTimeout(() => {
          if (location.pathname !== "/stories.html" && !window.__sssPackModalRendered) {
            location.href = "/stories.html?openpack=1";
          }
        }, 120);
        return false;
      });
    } else {
      a.removeAttribute("data-quota-blocked");
    }
  });
}

// ─── Story pack (top-up) ────────────────────────────────────────────
// One-time $4.99 = 3 extra story credits, no cap on how many packs.
// Wired to the create-story-pack-checkout edge function. Callers pass
// return_path (defaults to "/stories.html") — that's where the user
// lands with ?pack=ok or ?pack=cancel after Stripe.
export async function startStoryPackCheckout({ returnPath = "/stories.html" } = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, error: "Sign in first — then buy your pack." };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-story-pack-checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ return_path: returnPath }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) {
      return { ok: false, error: json.error || `Checkout failed (${res.status})` };
    }
    logEvent("story_pack_checkout_opened", { metadata: { return_path: returnPath } }).catch(() => {});
    // Redirect straight to Stripe Checkout. Return isn't reached in success case.
    window.location.href = json.url;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Couldn't reach checkout." };
  }
}

/* ===== PWA service worker registration ===== */
// Fire-and-forget; failures don't block anything.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("[sss-app] SW registration failed:", e);
    });
  });
}
