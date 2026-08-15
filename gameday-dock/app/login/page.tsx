import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="text-center text-sm font-bold uppercase tracking-widest text-slate-500">
        GameDay Dock
      </p>
      <h1 className="mt-2 text-center text-2xl font-bold text-slate-900">Sign in</h1>
      <p className="mt-2 text-center text-slate-600">
        We&apos;ll email you a magic link — no password needed.
      </p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
