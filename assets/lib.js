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

/* ===== PWA service worker registration ===== */
// Fire-and-forget; failures don't block anything.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("[sss-app] SW registration failed:", e);
    });
  });
}
