import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { cookies } from "next/headers";

import { readPeople } from "@/lib/photo-record";
import { sameName } from "@/lib/photo-types";

const DIRECTORY = path.join("data");
const ACCOUNTS = path.join(DIRECTORY, "accounts.json");
const SECRET = path.join(DIRECTORY, "session.key");
const COOKIE = "husfeld_session";
const MONTH = 60 * 60 * 24 * 30;
const derive = promisify(scrypt);

type Account = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  personId: string | null;
  salt: string;
  passwordHash: string;
};

export type AccountView = {
  name: string;
  email: string;
  personId: string | null;
};

type SessionBody = {
  id: string;
  exp: number;
};

export async function currentAccount(): Promise<AccountView | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  const id = token ? await accountIdFrom(token) : null;
  if (!id) return null;
  const account = (await readAccounts()).find((item) => item.id === id);
  if (!account) return null;
  return present(account);
}

export async function signUp(input: { firstName: string; lastName: string; email: string; password: string }): Promise<AccountView> {
  const firstName = cleanWords(input.firstName);
  const lastName = cleanWords(input.lastName);
  const email = cleanEmail(input.email);
  const password = input.password.trim();
  if (!firstName || !lastName) throw new Error("Type your first and last name.");
  if (!email) throw new Error("Type your email.");
  if (password.length < 4) throw new Error("Use a password of at least 4 characters.");
  const accounts = await readAccounts();
  if (accounts.some((account) => account.email === email)) throw new Error("That email already has a login.");
  const person = (await readPeople()).find((item) => matchesPerson(item.name, firstName, lastName));
  const salt = randomBytes(16).toString("hex");
  const account: Account = {
    id: randomBytes(16).toString("hex"),
    email,
    firstName,
    lastName,
    name: person?.name ?? `${firstName} ${lastName}`,
    personId: person?.id ?? null,
    salt,
    passwordHash: await hashPassword(password, salt),
  };
  accounts.push(account);
  await writeAccounts(accounts);
  await setSession(account.id);
  return present(account);
}

export async function logIn(email: string, password: string): Promise<AccountView> {
  const clean = cleanEmail(email);
  const cleanPassword = password.trim();
  if (!clean || !cleanPassword) throw new Error("Type your email and password.");
  const account = (await readAccounts()).find((item) => item.email === clean);
  const expected = account ? Buffer.from(account.passwordHash, "hex") : Buffer.alloc(32);
  const actual = Buffer.from(await hashPassword(cleanPassword, account?.salt ?? "missing"), "hex");
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!account || !matches) throw new Error("That email or password is not right.");
  await setSession(account.id);
  return present(account);
}

export async function logOut(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

function cleanWords(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function cleanEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function matchesPerson(personName: string, firstName: string, lastName: string): boolean {
  if (sameName(personName, `${firstName} ${lastName}`)) return true;
  const tokens = personName
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s,-]+/)
    .filter(Boolean);
  return tokens.length > 1 && sameName(tokens[0], firstName) && sameName(tokens[tokens.length - 1], lastName);
}

async function present(account: Account): Promise<AccountView> {
  const person = account.personId ? (await readPeople()).find((item) => item.id === account.personId) : undefined;
  return { name: person?.name ?? account.name, email: account.email, personId: person?.id ?? null };
}

async function setSession(accountId: string): Promise<void> {
  const exp = Date.now() + MONTH * 1000;
  const body = Buffer.from(JSON.stringify({ id: accountId, exp } satisfies SessionBody)).toString("base64url");
  const token = `${body}.${sign(body, await secret())}`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MONTH,
    secure: process.env.NODE_ENV === "production",
  });
}

async function accountIdFrom(token: string): Promise<string | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body, await secret());
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionBody;
    if (!parsed.id || parsed.exp < Date.now()) return null;
    return parsed.id;
  } catch {
    return null;
  }
}

function sign(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return Buffer.from((await derive(password, salt, 32)) as Buffer).toString("hex");
}

async function secret(): Promise<string> {
  try {
    return (await readFile(SECRET, "utf8")).trim();
  } catch {
    const next = randomBytes(32).toString("hex");
    await mkdir(DIRECTORY, { recursive: true });
    await writeFile(SECRET, next, { flag: "wx" }).catch(async () => readFile(SECRET, "utf8"));
    return (await readFile(SECRET, "utf8")).trim();
  }
}

async function readAccounts(): Promise<Account[]> {
  try {
    const parsed = JSON.parse(await readFile(ACCOUNTS, "utf8")) as { accounts?: Account[] };
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return [];
  }
}

async function writeAccounts(accounts: Account[]): Promise<void> {
  await mkdir(DIRECTORY, { recursive: true });
  await writeFile(ACCOUNTS, JSON.stringify({ accounts }, null, 2));
}
