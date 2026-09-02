<!-- receipts chapter for plugins/house/modules/database/rules/database.md -->
# Database

## Why this exists

A database can be wrong in ways that never show up in a diff or a failed test. A migration can apply out of order and still leave a schema that works today. A sync can silently overwrite a fact a human typed in, and the page it feeds still renders. A rebuild can wipe a tuning column, and the query that reads the table still returns rows. Each failure in this chapter renders fine, builds green, and is invisible to review, which is the same failure class the engineering module's build-time guards exist for, applied specifically to the state a database owns.

The four repos behind this module don't even agree on a database engine: repo-a runs laptop Postgres, repo-c runs Cloudflare D1 (its own `database.md` states the choice with an explicit contrast to repo-a's Postgres), and repo-b and repo-d both run Neon Postgres, each initiative with its own role. What follows is written to the shape of each failure, not to any one engine's syntax.

## Write forward-only numbered idempotent migrations, each opening with what and why

repo-a (`.claude/rules/database.md` §Migrations): numbered `db/migrations/NNN_*.sql`, applied in filename order, each wrapped in a transaction, the filename recorded in a `public_site._migrations` ledger by `scripts/db-migrate.mjs`. Every migration is idempotent. The repo squashed its own history once: migrations 001 through 101 moved to `db/migrations/_archive/`, outside the runner's glob and never replayed, and `db/baseline/schema.sql` (a `pg_dump --schema-only` snapshot) is pre-seeded into `_migrations` by `npm run db:setup`, one idempotent command that produces "an empty but complete schema... non-destructive on a DB that already has the baseline." Migration lineage is recorded inline in prose ("migration 138 absorbed the old standalone table...") specifically so a stale table name surviving in an old prompt or doc still resolves.

repo-c (`.claude/rules/database.md`): the same forward-only, no-down-migration stance, arrived at independently ("the fix for a bad migration is the next migration"), plus the convention that every migration file opens with a comment stating what it changes and why, for the reader who shows up a year later with no other context.

repo-d (`migrations/001_schema.sql`) takes a different shape for the same problem: there is no archive step, `001_schema.sql` **is** the baseline and replays on every run, "idempotent, edit it in place for new columns," with a separate `002_retire.sql` carrying drops. `npm run migrate` (`sync.mjs --migrate`) is Neon-only and idempotent, so a new table can land from CI without ever touching a laptop.

Incident, repo-a: a migration number collided across worktrees. A number that appears in no commit anywhere can still be taken, because a sibling checkout's uncommitted file already claims it. The recorded fix takes the next number from three places at once: the applied ledger, the committed files, and every sibling checkout's uncommitted files, not the ledger or the disk alone. The same incident produced a second rule: regenerate a schema-dump baseline only from a checkout that has been rebased onto the protected branch, because a dump taken from a stale checkout bakes a sibling's unmerged schema into what is supposed to be the source of truth. repo-a carries a live, unfixed instance of exactly this risk on record, issue #632: `db/baseline/schema.sql` is six migrations stale, and nothing gates it.

## Back up before a destructive migration, and diff after it

No incident recorded across the module's four repos for this rule; it entered on reasoning alone, carried by external, widely-held guidance. Take a full backup immediately before any migration that drops or rewrites data, and keep a rollback path that has actually been executed, "because a rollback plan you haven't run is a hypothesis." Then run a post-migration schema and row-count diff rather than trusting a zero exit code, because "mismatches and missing rows do not raise errors." A clean exit code is a claim about the process, not about the data.

repo-b gives the same reasoning a sharper, concrete form. `docs/runbooks/recovery.md` (246 lines) exists to cover backups, restore, and secret rotation for "the Neon DB that has no second copy anywhere." A store with no second copy is the one place where "we have a backup" cannot be asserted, only demonstrated by an actual restore, which is why this rule has no anchor in code: the backup lands outside the repo, and only a runbook step someone has actually run, and a pasted post-migration diff, are the control.

Native floor, as of 2026-09-02: checkpointing, which does not track files modified by bash commands and is documented as session-level recovery rather than a replacement for version control (https://code.claude.com/docs/en/checkpointing).

## Treat provenance columns as behavior

repo-c (`.claude/rules/services.md`): the domain model behind the camp's RV ledger never collapses its four roles, and a person to RV link is "stored, never inferred." `.claude/rules/database.md` extends the same discipline to sync state: provenance columns are "load-bearing, not metadata." A `manual` provenance value is never overwritten by a later sync, because a non-machine channel means "a human asserted this and the API can't see it."

repo-a memory (`feedback_row_lifecycle_not_ownership.md`): the writer-side half of the same discipline. A machine writer must enumerate the columns it does not own, because a writer that forgets one erases a human edit silently, and nothing downstream surfaces the loss until someone notices a fact reverted for no reason.

## Let row lifecycle decide a new table, never ownership

repo-a (`.claude/rules/database.md`, schema-shape rule, also carried in `feedback_row_lifecycle_not_ownership.md`): "New machine outputs: columns first, tables only for row churn. Ownership never justifies a new table; row lifecycle does." The schema retro domain (`scripts/retro/domains/schema.mjs`) is the enforcement surface for this whole family of table-shape rules, not only this one: it keeps the `db/tables.json` registry, live grants, and `information_schema` in lockstep across four invariants, "so who-writes-this/who-reads-this is a lookup instead of an archaeology dig," and it catches drift in either direction.

repo-c (`.claude/rules/database.md`): the mechanical form of the same rule. Every table carries a scoping key (a `season` column), and a table is rolled forward by inserting rows under a new key, "never a migration and never a truncate."

repo-b (`.claude/rules/revops.md`): the same idea stated as a warning about a specific pipeline rather than a schema mechanism: "never overwrite tuning state." Human-authored and derived tuning tables are keyed separately from the tables a pipeline rebuilds on every run, specifically so the tuning rows survive every rebuild.

## Add the table registry line in the same PR as the migration

repo-a (`scripts/retro/domains/schema.mjs`, `db/tables.json`): a migration that creates a table adds its registry line in the same PR, the same "docs ride along" principle applied to schema. The registry is checked against live grants and `information_schema` in both directions by the schema retro domain, which is what catches two independent failure modes: an unregistered table (a table nobody wrote down) and a stale registry line (grants that no longer exist).

repo-d (`docs/neon-tables.md`): the same registry idea from a repo with no retro tooling behind it, kept purely as a discipline: purpose, writer, readers, and data class per table, "kept in step with the baseline migration," so "the next database review starts from a lookup, not archaeology."

Native floor, as of 2026-09-02: hosted Code Review reading the repo CLAUDE.md, which flags a doc that a pull request makes outdated at nit severity only, for newly introduced violations, and only where that Team and Enterprise preview runs (https://code.claude.com/docs/en/code-review.md#claudemd).

## Store money as integer cents and reconcile against the books

repo-c (`.claude/rules/database.md`, `.claude/rules/stripe.md`, `.claude/rules/finance.md`): money is stored as `INTEGER` cents, and the floating-point type is banned at the schema level. Fees are read from Stripe's own `balance_transaction` object, never computed by arithmetic on the gross amount, "because the provider's number is the one the bank actually moved." Revenue is recognized on charge, not on payout, and every bucket in the taxonomy has a precise, written meaning; input that lands in none of them is a loud build-gate failure, not a silent drop. Reconciliation against the actual books, not against the sync's own totals, is the correctness gate: do not trust a sync until the figures tie out, because a total that agrees only with itself proves nothing.

## Give each initiative its own least-privilege role

repo-a (`db/SECURITY.md`, `.claude/rules/database.md`, `src/lib/db/client.ts`): two schemas, `public.*` (PII) and `public_site.*` (publishable), and two roles, the bare laptop user (reads both) and `tw_editor` (NocoDB CRUD on the editorial subset of `public_site` only, never anything on `public`). The one invariant that matters, "rendered code reads only `public_site.*`," is enforced two ways at once, because the build itself runs as the bare laptop user, which *can* read PII: rendered code imports only `src/lib/db/public-site.ts`, and a runtime regex guard in `src/lib/db/client.ts` rejects any tagged-template query naming a PII table. "This guard, not a grant, keeps PII out of the HTML." The bypass is deliberate and documented, not accidental: PII-aggregating build scripts use their own separate `postgres` client, "bypassing the guard by design: output is aggregate finance, never raw PII." Role assertion runs before anything else touches the data: `scripts/retro/cli.mjs` calls `assertSafeRole()`, which throws if `current_user === 'tw_editor'`, because "retro must not run as [that role] (reads PII). Run as the bare laptop user." `db/SECURITY.md` carries its own negative-test commands, so the firewall ships with a falsification procedure rather than a claim; the general rule for proving a check can fail lives in the engineering module, anchored on a different incident, and this is that same idea applied to the PII firewall specifically.

The asymmetry the rule warns about is a documented gotcha, not a hypothetical: a review of migrations 138-139 found that new `public_site.*` relations, including views (which execute with the owner's privileges), auto-grant to `tw_editor`, while new `public.*` tables need no REVOKE to stay closed. "This is the exact inverse of the `public.*` rule... so don't generalize one to the other."

repo-d (`db/connection.mjs`, `CLAUDE.md`): the same posture in a second Neon project. `repo_g_app` owns its own `repo_g` schema, has `SELECT` only on `reference.*`, and is blind to repo-f's tables; each initiative loads its own `.env` via `process.loadEnvFile` ("no `dotenv`"), and CLAUDE.md states the rule plainly: "Never point repo-g scripts at the root `.env` (the admin string) or vice versa."

Native floor, as of 2026-09-02: the Bash sandbox, which isolates Bash subprocesses and leaves the built-in file tools to the permission system, and which never inspects the queries a script issues once it is running (https://code.claude.com/docs/en/sandboxing).

## Never let a write script pick its target from a dotfile

repo-a: out-of-band matchers read `DATABASE_URL` from the exported environment, "deliberately not from `.dev.vars`, a write script should not pick its target database out of a dotfile." A read-only build may still load a dotfile for vendor keys (`--env-file=.dev.vars` is fine there); the line the rule draws is specifically about what decides *which database* a write lands in, not about dotfiles in general.

Native floor, as of 2026-09-02: Bash permission rules, which match the command text after a built-in, non-configurable wrapper list is stripped; environment runners such as direnv are not on that list (https://code.claude.com/docs/en/permissions.md).

## Sources

- https://logisam.com/7-essential-database-migration-best-practices-for-2025/ (backup-before-destructive-migration and post-migration diff, external-guidance.md §d items 8-9)
