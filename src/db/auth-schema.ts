/**
 * Better Auth tables — `user`, `session`, `account`, `verification`.
 *
 * These live in their own file, apart from `schema.ts`, on purpose. Better Auth
 * owns their shape: the column list is dictated by the library, and if it drifts
 * the failure is a runtime "field does not exist in the schema" error rather
 * than a type error. Keeping them separate means the file you edit for the
 * project's own tables never contains anything you're not allowed to change.
 *
 * They are re-exported from `schema.ts` so drizzle-kit sees one schema entry
 * point and the Drizzle client has every table in scope.
 *
 * ── Regenerating this file ──
 * There is no `@better-auth/cli` in this project, so these definitions are
 * written by hand. They were not copied from a blog post — they were dumped
 * from the installed library itself, which is the only source that can't be out
 * of date:
 *
 *   node --input-type=module -e "
 *     const { getAuthTables } = await import('better-auth/db');
 *     console.log(JSON.stringify(getAuthTables({}), null, 2));
 *   "
 *
 * Run that after any `better-auth` upgrade and diff it against this file. It is
 * how `account.issuer` below was caught — it is required in 1.7 and is missing
 * from most Better Auth schema examples you'll find online.
 *
 * ── Two things that will bite if you change them ──
 *
 * 1. The **property keys must stay camelCase** (`emailVerified`, `userId`,
 *    `expiresAt`). The Drizzle adapter resolves a Better Auth field to a column
 *    by plain property lookup — `table[fieldName]` — and its field names are
 *    camelCase. The *column* names (the string arguments) are ours to choose,
 *    so they follow this repo's snake_case convention. The adapter's `camelCase`
 *    option does NOT change this; it only affects its schema generator.
 *
 * 2. `account` here is Better Auth's **OAuth provider link** table, and the
 *    `password` column is where a credential user's password hash lives. It has
 *    nothing to do with trading. The broker account table must be named
 *    `trading_accounts` — see the note in `schema.ts`.
 */
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * `withTimezone: true` on every timestamp, matching the convention in
 * `schema.ts`. Better Auth hands Drizzle a JS `Date` either way, so this costs
 * nothing and keeps one rule for the whole database instead of two.
 */
const tsCol = (name: string) => timestamp(name, { withTimezone: true });

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: tsCol("created_at").notNull().defaultNow(),
  updatedAt: tsCol("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  // Cascade, so deleting a user really does log out every device they own
  // instead of leaving orphan rows that still resolve to a session.
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: tsCol("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: tsCol("created_at").notNull().defaultNow(),
  updatedAt: tsCol("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  // Required as of Better Auth 1.7. For email+password sign-ups the library
  // fills it in itself; it is not something this app ever sets.
  issuer: text("issuer").notNull(),
  // Only ever populated for credential accounts, and only ever a hash.
  password: text("password"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: tsCol("access_token_expires_at"),
  refreshTokenExpiresAt: tsCol("refresh_token_expires_at"),
  scope: text("scope"),
  createdAt: tsCol("created_at").notNull().defaultNow(),
  updatedAt: tsCol("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: tsCol("expires_at").notNull(),
  createdAt: tsCol("created_at").notNull().defaultNow(),
  updatedAt: tsCol("updated_at").notNull().defaultNow(),
});

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
