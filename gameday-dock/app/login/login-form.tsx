"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchParams = useSearchParams();
  // After login, land back where the user was headed (e.g. an invite link).
  const next = searchParams.get("next") ?? "/";

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="card mt-8 text-center">
        <p className="text-2xl">📬</p>
        <h2 className="mt-2 text-lg font-bold text-slate-900">Check your email</h2>
        <p className="mt-1 text-slate-600">
          We sent a sign-in link to <span className="font-semibold">{email}</span>.
          Open it on this device.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={sendLink} className="mt-8 flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="label">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          className="field"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Sending…" : "Email me a magic link"}
      </button>
    </form>
  );
}
