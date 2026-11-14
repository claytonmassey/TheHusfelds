import { currentAccount, logIn, logOut, signUp } from "@/lib/accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ account: await currentAccount() });
}

export async function POST(request: Request) {
  let body: { action?: unknown; firstName?: unknown; lastName?: unknown; email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Type your email and password." }, { status: 400 });
  }

  const action = body.action === "signup" || body.action === "login" || body.action === "logout" ? body.action : "";
  const text = (value: unknown) => (typeof value === "string" ? value : "");

  try {
    if (action === "logout") {
      await logOut();
      return Response.json({ account: null });
    }
    if (action === "signup") {
      return Response.json({
        account: await signUp({
          firstName: text(body.firstName),
          lastName: text(body.lastName),
          email: text(body.email),
          password: text(body.password),
        }),
      });
    }
    if (action === "login") return Response.json({ account: await logIn(text(body.email), text(body.password)) });
    return Response.json({ error: "Type your email and password." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That could not be saved.";
    const status = /Type your|password|already has a login|not right/.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
