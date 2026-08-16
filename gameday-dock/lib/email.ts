/**
 * Email sending via Resend's REST API. If RESEND_API_KEY is not configured
 * (local dev), emails are logged to the server console instead so every flow
 * stays testable without an account.
 */

const FROM = process.env.EMAIL_FROM ?? "GameDay Dock <onboarding@resend.dev>";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(
      `[email:dev] to=${opts.to} subject="${opts.subject}"\n${opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`
    );
    return { ok: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [opts.to], subject: opts.subject, html: opts.html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend ${res.status}: ${body}`);
      return { ok: false, error: `Resend ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[email] send failed", e);
    return { ok: false, error: String(e) };
  }
}

/** Shared wrapper so every email looks consistent. */
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="font-size:14px;font-weight:700;letter-spacing:.08em;color:#334155;text-transform:uppercase;padding:8px 4px;">GameDay Dock</div>
    <div style="background:#ffffff;border-radius:12px;padding:28px 24px;border:1px solid #e4e4e7;">
      <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${title}</h1>
      ${bodyHtml}
    </div>
    <div style="font-size:12px;color:#71717a;padding:12px 4px;">Sent by GameDay Dock — dock scheduling for game day.</div>
  </div>
</body></html>`;
}

export function detailRows(rows: [string, string][]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0;">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 8px 6px 0;color:#71717a;font-size:14px;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${v}</td></tr>`
    )
    .join("")}</table>`;
}

export function ctaButton(href: string, label: string): string {
  return `<p style="margin:20px 0 4px;"><a href="${href}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;font-size:15px;">${label}</a></p>`;
}

export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}
