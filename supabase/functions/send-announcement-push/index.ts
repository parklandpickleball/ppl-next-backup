// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Must match what you put in the webhook header
const WEBHOOK_SECRET = Deno.env.get("ANNOUNCEMENT_WEBHOOK_SECRET")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Verify webhook secret header
  const secret = req.headers.get("x-webhook-secret") ?? "";
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Supabase webhook payload includes the inserted row under `record`
  let event: any;
  try {
    event = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const bodyText =
    event?.record?.body ??
    event?.record?.message ??
    "New announcement";

  // Fetch all push tokens
  const tokensRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_push_tokens?select=expo_push_token`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!tokensRes.ok) {
    return json({ error: "Failed to fetch tokens", details: await tokensRes.text() }, 500);
  }

  const rows = await tokensRes.json();
  const tokens = Array.from(new Set((rows ?? []).map((r: any) => r.expo_push_token))).filter(Boolean);

  if (!tokens.length) return json({ ok: true, sent: 0 });

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: "New Announcement",
    body: bodyText,
  }));

  const expoRes = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  const expoJson = await expoRes.json().catch(() => ({}));

  return json({ ok: true, sent: messages.length, expo: expoJson });
});
