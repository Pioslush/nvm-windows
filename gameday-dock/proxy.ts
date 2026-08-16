import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Keeps Supabase auth sessions fresh on every request (Next 16 proxy). */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Trigger a token refresh if needed; result is written to cookies above.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Skip static assets and the public gate page (no auth there, ever).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|gate/|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
