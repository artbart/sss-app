// Stuff So Sweet app — shared library.
// Imported as an ES module from each page. Initializes the Supabase client,
// exposes auth helpers, and provides a small event-logging utility.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = "https://gmhbcxylqubhxozomhlt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtaGJjeHlscXViaHhvem9taGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTk5OTksImV4cCI6MjA5MjczNTk5OX0.GAM73P5X7fT1BIziTfvqUpFT2W_W5EtFb5Gze5cIFfY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,  // /auth/callback handles the hash itself, but this is fine to leave on
  },
});

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
  } catch (e) {
    console.warn("[sss-app] logEvent threw:", e);
  }
}

/* ===== UI helpers ===== */

// Inject a standard top-bar into the page.
// Renders into the first element matching `#topbar`.
export function renderTopbar(target = "#topbar") {
  const el = document.querySelector(target);
  if (!el) return;
  el.innerHTML = `
    <div class="topbar">
      <a class="brand" href="/stories.html">Stuff So Sweet</a>
      <div class="menu">
        <a href="/stories.html">Stories</a>
        <a href="/settings.html">Settings</a>
        <button id="signOutBtn" type="button">Sign out</button>
      </div>
    </div>
  `;
  document.getElementById("signOutBtn")?.addEventListener("click", () => signOut("/"));
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
