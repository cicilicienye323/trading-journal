/**
 * Database schema — Project 1 (Trading Journal), spec VCI-3 §4.
 *
 * Three tables of our own (`trading_accounts`, `trades`, `import_batches`) plus
 * Better Auth's four, re-exported below so drizzle-kit sees one schema entry
 * point and the Drizzle client has every table in scope.
 *
 * The scaffolding `healthcheck` table that used to live here is gone — it
 * existed only to prove the migration pipeline worked before there were real
 * tables, and there are real tables now. **`/api/health` stays.** That route no
 * longer reads any table (it runs `select 1` and asks the catalog whether
 * `user` exists), and CI's container smoke test, docker-compose's healthcheck,
 * `deploy-bootstrap.mjs`, and `migrate-production.yml` all poll it. Deleting it
 * turns CI red for reasons that look nothing like the cause.
 *
 * ── The four conventions this file is built on ──
 *
 * 1. **Money and prices are `numeric`, never `double precision`.** Binary
 *    floating point cannot represent 0.1 exactly, so `0.1 + 0.2` is
 *    0.30000000000000004 and a column of them drifts. In a P&L column that is
 *    not a rounding nit — it is the number the user checks against their broker
 *    statement, and one cent of disagreement destroys trust in the whole app.
 *    `numeric` is exact decimal: `100.00 + (-3.50) + (-1.25)` is exactly 95.25.
 *
 *    The consequence in TypeScript, and it surprises people: a `numeric` column
 *    is typed **`string`**, not `number`. That is the guarantee working, not a
 *    wart — the moment a value becomes a JS `number` it has been through a
 *    float, and the exactness is already gone. So money stays a string from the
 *    HTML input, through Zod, into Drizzle, and back out again. The Zod schemas
 *    in `lib/schemas/` never call `z.coerce.number()` for these fields, and
 *    `lib/money.ts` explains why at length.
 *
 * 2. **Every timestamp is `timestamptz`** (`withTimezone: true`), always stored
 *    in UTC. Trading data is timestamped on a broker server that is usually in
 *    EET and observes DST; it is displayed in whatever zone the reader is in. A
 *    naive `timestamp` drops the offset, so the two readings become
 *    indistinguishable and the bug only appears across a DST boundary — twice a
 *    year, in production, on data you can no longer reconstruct.
 *
 * 3. **Foreign keys to the signed-in user are `text`**, referencing `user.id`.
 *    Better Auth generates string ids, not UUIDs; spec §4.2 matches this. Our
 *    own primary keys are `uuid` with `gen_random_uuid()`.
 *
 * 4. **Naming trap:** Better Auth already owns a table called `account` — OAuth
 *    provider links and password hashes, nothing to do with trading. The broker
 *    account table is `trading_accounts`. `auth-schema.test.ts` asserts the two
 *    names stay apart.
 */
import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

/**
 * Better Auth's tables. Re-exported so drizzle-kit sees a single schema entry
 * point and the Drizzle client has every table in scope — not because you need
 * to touch them.
 */
export * from "./auth-schema";

/**
 * Every timestamp column in this file goes through here, so "we use timestamptz
 * everywhere" is enforced by there being no other way to declare one rather
 * than by remembering. Same helper, same reasoning, as `auth-schema.ts`.
 */
const tsCol = (name: string) => timestamp(name, { withTimezone: true });

/**
 * `created_at` / `updated_at`, which every table here carries.
 *
 * `$onUpdate` is a Drizzle-side hook, not a database trigger: Postgres has no
 * `ON UPDATE CURRENT_TIMESTAMP` the way MySQL does. So this fires for updates
 * issued through Drizzle and *not* for a hand-written `UPDATE` in psql. That
 * trade-off is fine here — `updated_at` is for showing the user when they last
 * touched a row, not for replication or conflict resolution. If it ever becomes
 * load-bearing, it needs a real trigger.
 */
const timestamps = {
  createdAt: tsCol("created_at").notNull().defaultNow(),
  updatedAt: tsCol("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * `buy` | `sell`. A Postgres enum rather than a `varchar` + check constraint:
 * it gives the same validation, but Drizzle infers a TypeScript union from it,
 * so a typo like `"byu"` is a compile error instead of a constraint violation
 * discovered at runtime.
 *
 * The cost, and it is worth knowing before you pick an enum: adding a value is
 * `ALTER TYPE ... ADD VALUE`, and *removing* one requires rebuilding the type.
 * For a set that is closed by definition — a trade is long or short, there is
 * no third thing — that cost never comes due.
 */
export const tradeDirection = pgEnum("trade_direction", ["buy", "sell"]);

/**
 * Where the row came from. `manual` is typed into `/trades/new`; `import` is
 * parsed out of an MT5 history file in Slice 2.
 *
 * Worth keeping even though nothing branches on it yet: it is the column that
 * answers "is this number something the user asserted, or something the broker
 * did?" — and after the importer exists, that question gets asked constantly.
 */
export const tradeSource = pgEnum("trade_source", ["manual", "import"]);

/**
 * A broker account — spec §4.2. "Exness Real 1", "FTMO Challenge 10K".
 *
 * Trades hang off this rather than off the user directly because the numbers
 * only mean anything per account: an equity curve mixing a 10K prop challenge
 * with a 500 USD personal account is a curve of nothing.
 */
export const tradingAccounts = pgTable(
  "trading_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Cascade: deleting a user really does remove their data, rather than
    // leaving orphan accounts that no query can reach but the DPA still counts.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 80 }).notNull(),
    broker: varchar("broker", { length: 80 }),
    accountNumber: varchar("account_number", { length: 40 }),

    // ISO 4217 is exactly three letters, so `char(3)` states the shape in the
    // schema instead of hoping the application checks it.
    currency: char("currency", { length: 3 }).notNull().default("USD"),

    // The equity curve's origin point. `numeric` for the reason at the top of
    // the file, and note the default is the **string** "0": a numeric column is
    // a string in Drizzle, and passing `0` here would be a type error.
    startingBalance: numeric("starting_balance", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),

    /**
     * The broker server's clock, as an **IANA zone name** — `Europe/Athens`,
     * not `+02:00`.
     *
     * This is the single most important column in the table and the one most
     * people get wrong. MT4/MT5 history files write wall-clock time in the
     * server's zone with no offset attached. Most brokers run EET, which is
     * GMT+2 in winter and GMT+3 in summer. Store an offset and every trade on
     * the wrong side of a DST switch is off by an hour; store the zone name and
     * the library applies the rule that was in force on that date.
     *
     * Per-account, not a constant, because brokers genuinely differ — some run
     * GMT+0, some fixed GMT+3. The default matches the majority and matches the
     * demo account in spec §9.
     *
     * `/trades/new` reads this too: the times you type into the form are broker
     * wall-clock, and this is what they are converted from. See
     * `lib/trades/time.ts`.
     */
    serverTimezone: varchar("server_timezone", { length: 64 }).notNull().default("Europe/Athens"),

    /**
     * Prop-firm risk limits, as a **percentage** of `starting_balance`.
     *
     * Percent rather than a cash amount because that is the form the rule is
     * actually written in — "max drawdown 10%, daily loss 5%" — and because a
     * percentage stays correct if `starting_balance` is later edited, where a
     * cash figure silently goes stale. Storing a rule in the shape it was
     * given is a habit worth carrying into Projects 2 and 3.
     *
     * **Nullable, not defaulted to zero.** `0` would read as "your limit is
     * zero percent", which marks every account as instantly blown. NULL means
     * "no limit configured" — a personal account, not a challenge. The
     * difference between *zero* and *unknown* is one a finance app has to keep
     * straight, and spec §2 P1/P2 require the UI to render NULL as "no limit
     * set" rather than as a 0% bar.
     */
    maxDrawdownLimitPct: numeric("max_drawdown_limit_pct", { precision: 5, scale: 2 }),
    dailyLossLimitPct: numeric("daily_loss_limit_pct", { precision: 5, scale: 2 }),

    ...timestamps,
  },
  (table) => [
    // Every list of accounts is "mine", so this is the only access path that
    // matters. See §8.3: user_id is in the WHERE clause of every query.
    index("idx_trading_accounts_user").on(table.userId),

    // Guards the range the UI cannot: a limit of 0 or 150 percent is
    // meaningless. Nullable columns pass a CHECK when NULL, so this constrains
    // the value without making the column required — which is exactly the
    // "no limit set" case above.
    check(
      "trading_accounts_max_drawdown_pct_range",
      sql`${table.maxDrawdownLimitPct} IS NULL OR (${table.maxDrawdownLimitPct} > 0 AND ${table.maxDrawdownLimitPct} <= 100)`,
    ),
    check(
      "trading_accounts_daily_loss_pct_range",
      sql`${table.dailyLossLimitPct} IS NULL OR (${table.dailyLossLimitPct} > 0 AND ${table.dailyLossLimitPct} <= 100)`,
    ),
  ],
);

/**
 * One CSV import — spec §4.4. A small audit trail: what file, when, how many
 * rows went in, how many were skipped.
 *
 * The table exists now, in Slice 1b, even though the importer is Slice 2, for
 * one narrow reason: `trades.import_batch_id` is a foreign key and a foreign
 * key needs something to point at. **No import logic belongs here yet.**
 *
 * The same shape reappears as the audit log in Project 3, which is the general
 * lesson: when data arrives from outside the app, record the arrival, not just
 * the data. "Where did these 180 rows come from?" is unanswerable afterwards
 * unless you wrote it down at the time.
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Denormalized from the account for the same reason as on `trades` — see
    // the long note there. It lets "my batches" be one predicate, no join.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    tradingAccountId: uuid("trading_account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),

    filename: varchar("filename", { length: 255 }).notNull(),

    // Counts, not money: `integer` is the right type and float is not a hazard
    // here. rowCount = insertedCount + skippedCount, but that invariant is the
    // importer's to hold, not a constraint — a partial failure should still be
    // recordable rather than rejected by the database.
    rowCount: integer("row_count").notNull(),
    insertedCount: integer("inserted_count").notNull(),
    skippedCount: integer("skipped_count").notNull(),

    createdAt: tsCol("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_import_batches_user").on(table.userId)],
);

/**
 * A closed trade — spec §4.3. The centre of the application.
 *
 * v1 records closed positions only. An open position has no `close_price` and
 * no P&L, so half the columns here would be nullable and every statistic would
 * need a "but only the closed ones" clause. Open trades are explicitly out of
 * scope for v1 (§11); adding them later means a nullable `closed_at` and a
 * status column, which is a clean migration.
 */
export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * **Denormalized from `trading_accounts.user_id` on purpose** — §4.3.
     *
     * It is derivable: a trade belongs to an account, and the account belongs
     * to a user. Storing it again is textbook redundancy, and it is still the
     * right call, because of what it does to the authorization rule.
     *
     * With this column, "only my trades" is `eq(trades.userId, session.user.id)`
     * — one predicate, on the table being queried, that can go in the WHERE
     * clause of *every* select, update, and delete. Without it, the same rule
     * needs a join to `trading_accounts` on every query, including the deletes.
     * A rule that requires a join is a rule that gets dropped the day someone
     * writes a query in a hurry, and the failure mode of that omission is one
     * user reading another's trades.
     *
     * So the redundancy buys an authorization invariant that is greppable and
     * uniform. The price is a consistency risk — this column could disagree
     * with the account's — and that is contained by the fact that only
     * `actions/trades.ts` inserts here, and it fills this in from the *already
     * ownership-checked* account row rather than from client input.
     *
     * This is the trade-off to be able to defend out loud: denormalize when it
     * makes a security rule uniform, not when it merely saves a join.
     */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    tradingAccountId: uuid("trading_account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),

    // SET NULL, not CASCADE: deleting the record of an import must not delete
    // the trades it brought in. The user's data outlives the paperwork about
    // where it came from.
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, {
      onDelete: "set null",
    }),

    // The broker's ticket / position id. NULL for anything typed by hand — see
    // the partial unique index at the bottom, which is the whole reason this
    // column is nullable rather than defaulted to "".
    externalTicket: varchar("external_ticket", { length: 40 }),

    // Stored uppercase and trimmed — `normalizeSymbol()` in lib/trades. Doing
    // it on the way in means `eurusd` and `EURUSD ` group together in every
    // per-symbol statistic without a single `lower()` in a query.
    symbol: varchar("symbol", { length: 20 }).notNull(),

    direction: tradeDirection("direction").notNull(),

    // Lot size. Money-adjacent, so `numeric` for the same exactness reason:
    // 0.01-lot trades are normal and 0.1 + 0.2 must be 0.3.
    volume: numeric("volume", { precision: 12, scale: 2 }).notNull(),

    openedAt: tsCol("opened_at").notNull(),
    closedAt: tsCol("closed_at").notNull(),

    openPrice: numeric("open_price", { precision: 18, scale: 5 }).notNull(),
    closePrice: numeric("close_price", { precision: 18, scale: 5 }).notNull(),

    // Scale 5 across all prices: FX quotes five decimals (EURUSD 1.08453),
    // metals and JPY pairs fewer. One scale for every price column keeps
    // comparisons and arithmetic uniform.
    stopLoss: numeric("stop_loss", { precision: 18, scale: 5 }),
    takeProfit: numeric("take_profit", { precision: 18, scale: 5 }),

    // Before costs. Negative on a losing trade, which is why there is no
    // CHECK > 0 here.
    grossProfit: numeric("gross_profit", { precision: 18, scale: 2 }).notNull(),

    // MetaTrader's convention: commission is written as a **negative** number
    // because it is a cost. We keep the broker's sign rather than flipping it,
    // so a value pasted from a statement matches what is stored — and so
    // `net_profit` below is a plain sum instead of a sum-and-a-subtraction that
    // someone will eventually get backwards.
    commission: numeric("commission", { precision: 18, scale: 2 }).notNull().default("0"),

    // Overnight financing. Genuinely either sign — you are paid it on one side
    // of a positive interest-rate differential and charged it on the other.
    swap: numeric("swap", { precision: 18, scale: 2 }).notNull().default("0"),

    /**
     * **`GENERATED ALWAYS AS (...) STORED`** — computed by Postgres, on write,
     * from the three columns above. Not settable, and it disappears from
     * `$inferInsert`, so an insert that tries to provide it is a type error.
     *
     * Why the database and not the application: this is the number the entire
     * app is about — every statistic, the equity curve, the win rate. If it
     * were computed in TypeScript, it would be computed in the manual-entry
     * action, again in the CSV importer, and probably a third time in the seed
     * script, and the day one of them forgets `swap` there is no way to tell
     * which rows are wrong. Here there is exactly one definition and it cannot
     * be bypassed — not by a migration, not by psql, not by a future importer.
     *
     * STORED rather than VIRTUAL because Postgres only implements STORED, and
     * because it is written once and read constantly, which is the case stored
     * generation is for. It is indexable, too, if sorting by P&L ever needs it.
     *
     * The arithmetic is `numeric`, so it is exact: -3.50 and -1.25 against
     * 100.00 gives exactly 95.25, with no float epsilon anywhere.
     */
    netProfit: numeric("net_profit", { precision: 18, scale: 2 })
      .notNull()
      .generatedAlwaysAs(sql`gross_profit + commission + swap`),

    /**
     * Risk in account currency, and the result in R — Slice 3 computes these
     * (§5.2) from `stop_loss`, `volume`, and the instrument's contract size.
     *
     * Nullable because they are genuinely unknowable for a trade entered
     * without a stop loss. NULL here means "cannot be derived", which is
     * different from 0 ("risked nothing") — and the statistics in §5.3 must
     * exclude these rows rather than treat them as zero-risk, which would make
     * the average R-multiple silently optimistic.
     *
     * Application-computed rather than generated, unlike `net_profit`, because
     * the formula needs the instrument's contract size — data that is not in
     * this row. A generated column can only see its own row.
     */
    riskAmount: numeric("risk_amount", { precision: 18, scale: 2 }),
    rMultiple: numeric("r_multiple", { precision: 10, scale: 3 }),

    source: tradeSource("source").notNull().default("manual"),

    /**
     * Free text in v1 — deliberately **not** a `tags` table with a join table.
     *
     * v1 needs none of what normalization would buy: no renaming a tag across
     * trades, no tag colours, no multiple tags per trade. That is two extra
     * tables, a management UI, and a few hours, for zero v1 benefit; and if it
     * is ever needed, the migration from this column is straightforward.
     *
     * This is the decision to repeat in Projects 2 and 3: don't build the
     * general version of a feature that has no users yet.
     */
    setupTag: varchar("setup_tag", { length: 40 }),

    // `text`, not `varchar(n)`: there is no natural limit on a trade note, and
    // in Postgres `text` and `varchar` have identical performance.
    notes: text("notes"),

    ...timestamps,
  },
  (table) => [
    /**
     * Import idempotency: a broker ticket is unique within an account, so
     * re-uploading the same MT5 file updates rather than doubles every trade.
     * Manual entries have no ticket and must not collide with each other.
     *
     * ── Why `WHERE external_ticket IS NOT NULL`, precisely ──
     * It is tempting to say the clause is what stops manual rows colliding.
     * That is not quite it, and the real answer is better interview material.
     * Postgres unique indexes are `NULLS DISTINCT` by default: two NULLs are
     * not considered equal, so unlimited manual rows already coexist without
     * any `WHERE`. What the clause actually buys is three things:
     *
     *   1. **It states the rule.** "Unique among imported trades" is readable
     *      straight off the schema, instead of depending on the reader knowing
     *      Postgres' NULL-comparison rule — and on nobody later adding
     *      `NULLS NOT DISTINCT` (Postgres 15+), which would break manual entry
     *      instantly and confusingly.
     *   2. **The index only covers rows the constraint applies to**, so it stays
     *      proportional to imported trades rather than to the whole table.
     *   3. Related: it is the index the Slice 2 upsert will target in
     *      `ON CONFLICT`, and a partial index requires a matching predicate
     *      there — so the shape is load-bearing, not decorative.
     *
     * If the clause ever goes missing from the generated SQL, nothing fails
     * here. It surfaces in Slice 2. Read the migration and confirm it is there.
     */
    uniqueIndex("trades_account_ticket_uniq")
      .on(table.tradingAccountId, table.externalTicket)
      .where(sql`${table.externalTicket} IS NOT NULL`),

    // The list page and the equity curve both read "my trades, newest first",
    // so the index carries the sort direction. A DESC index also serves ASC
    // scans, so this one covers both orders.
    index("trades_user_closed_idx").on(table.userId, table.closedAt.desc()),
    index("trades_account_closed_idx").on(table.tradingAccountId, table.closedAt.desc()),

    // Per-symbol breakdown (§5.3) and the symbol filter on /trades.
    index("trades_user_symbol_idx").on(table.userId, table.symbol),

    // Constraints the UI can't be trusted to hold, because the UI is not the
    // only writer — the importer and the seed script write here too, and a
    // constraint in the database applies to all three.
    check("trades_volume_positive", sql`${table.volume} > 0`),
    check("trades_open_price_positive", sql`${table.openPrice} > 0`),
    check("trades_close_price_positive", sql`${table.closePrice} > 0`),

    // A trade that closes before it opens is not a data-entry preference, it is
    // corrupt. `>=` rather than `>`: a scalping fill can open and close inside
    // the same second, and MT5 timestamps are second-resolution.
    check("trades_closed_after_opened", sql`${table.closedAt} >= ${table.openedAt}`),
  ],
);

export type TradingAccount = typeof tradingAccounts.$inferSelect;
export type NewTradingAccount = typeof tradingAccounts.$inferInsert;

export type Trade = typeof trades.$inferSelect;
/**
 * Note what is *absent* from this type: `netProfit`. Generated columns are not
 * insertable, so Drizzle drops it — the compiler enforces "don't compute P&L in
 * application code" for free.
 */
export type NewTrade = typeof trades.$inferInsert;

export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;

/** The direction / source unions, inferred from the enums rather than retyped. */
export type TradeDirection = (typeof tradeDirection.enumValues)[number];
export type TradeSource = (typeof tradeSource.enumValues)[number];
