<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Database

## Write forward-only numbered idempotent migrations, each opening with what and why

Number every migration, apply them in filename order, wrap each one in a transaction, and record the applied filename in a ledger table, because the order and the ledger are the only proof of what a database has already seen. There are no down-migrations: the fix for a bad migration is the next migration.
Make every migration idempotent, and open the file with a comment saying what it changes and why, so a replay is safe and the reader a year later does not reconstruct intent from the DDL. Record lineage in that comment when a migration absorbs or renames a table, so a stale table name in an old prompt still resolves.
Take the next number from the ledger, the committed files, and every sibling checkout's uncommitted files, because a shared database makes a number taken that appears in no commit. Squash old migrations into a baseline outside the runner's glob, and pre-seed the ledger with the squashed history. Where the baseline is instead the file replayed on every run, edit it in place and keep drops in a separate retire file. Regenerate a schema dump only from a checkout rebased onto the protected branch, because a dump taken from a stale one bakes in a sibling's unmerged schema.
Anchor: the migration runner, which applies in filename order, writes the ledger row in the same transaction, and skips a filename the ledger already holds, plus one idempotent setup command that produces an empty but complete schema.
Receipts: `docs/handbook/database.md#write-forward-only-numbered-idempotent-migrations-each-opening-with-what-and-why`

## Back up before a destructive migration, and diff after it

Take a full backup immediately before any migration that drops or rewrites data, and keep a rollback path you have actually executed, because a rollback plan you have never run is a hypothesis.
Diff the schema and the row counts before and after, because a migration that misses rows or lands the wrong column type still exits zero. A clean exit code is a claim about the process, not about the data.
Anchor: none (because the backup lands outside the repo and the session cannot restore it either: checkpoints do not track what a Bash command changed and are not a substitute for version control, so the runbook step and the pasted post-migration diff are the control).
Receipts: `docs/handbook/database.md#back-up-before-a-destructive-migration-and-diff-after-it`

## Treat provenance columns as behavior

Store how a row got its values, never infer the link later, and never collapse two roles that differ in the real world, because an inferred link cannot be audited or reversed.
A row marked as human-asserted is never overwritten by a sync: a non-machine provenance means a person knows something the upstream API cannot see. Read the provenance before writing, not after.
Make every machine writer enumerate the columns it does not own, because a writer that forgets one erases a human edit silently and nothing surfaces the loss.
Anchor: a sync test that runs twice over a hand-edited row and asserts both the edit and its provenance survive the second run.
Receipts: `docs/handbook/database.md#treat-provenance-columns-as-behavior`

## Let row lifecycle decide a new table, never ownership

Add columns to the existing table of the same grain first, and give machine output its own table only when its writer deletes and recreates rows on every run. Ownership is not a normalization criterion: who writes a column says nothing about whether the row survives the next run.
Test row churn, not the writer, because a rebuild that drops and reinserts rows destroys hand-entered columns and no label or grant can prevent that. A writer that upserts stable rows and owns named columns can share a table safely.
Key human-authored and derived tuning rows separately from rebuilt rows so they survive every rebuild. Put a scoping key on every scoped table, and roll forward by inserting rows under a new key, never by a migration and never by a truncate.
Anchor: column-scoped grants on a mixed-ownership table, so a hand edit to a machine column is rejected at save instead of silently reverted on the next run.
Receipts: `docs/handbook/database.md#let-row-lifecycle-decide-a-new-table-never-ownership`

## Add the table registry line in the same PR as the migration

Ship the registry line for a new table in the same PR as the migration that creates it, because a registry filled in later is a registry filled in from memory.
Record purpose, writer, readers, and data class for each table, so the next database review starts from a lookup instead of archaeology.
Check the registry against live grants in both directions, because a table missing from the registry and a registry line whose grants no longer exist are both drift, and only the two-way check catches the second.
Anchor: a schema invariant that fails on an unregistered table and on a stale registry line, run before any publish or deploy, because the hosted review that notices a doc going stale raises it as a non-blocking nit and is not available in every org.
Receipts: `docs/handbook/database.md#add-the-table-registry-line-in-the-same-pr-as-the-migration`

## Store money as integer cents and reconcile against the books

Store every money column as integer cents and ban the floating-point type at the schema level, because a rounding error in a stored amount is unrecoverable once it has been summed.
Read a fee from the provider's own record of that transaction, never from arithmetic on the gross amount, because the provider's number is the one the bank actually moved.
Treat reconciliation against an external statement as the correctness gate, and do not trust a sync until the figures tie out. A total that agrees only with itself proves nothing.
Anchor: the column type in the schema, plus a reconciliation check that compares the summed rows against the external statement and fails on any difference.
Receipts: `docs/handbook/database.md#store-money-as-integer-cents-and-reconcile-against-the-books`

## Give each initiative its own least-privilege role

Separate publishable data from sensitive data by schema and by role, give each initiative its own role and its own env file, and never let one reach the other, because crossing the streams once is enough to leak.
Assert the running role before a pipeline touches anything, and refuse to run as the wrong one, because a privileged connection turns a read-only job into an unlogged write.
Enforce the firewall with a runtime guard and not only with a grant whenever the build itself runs as a privileged role, since a grant that permits the read cannot stop it and the harness stops at the tool boundary: permission rules and the sandbox never reach inside a script's own database queries. Ship the guard with its own falsification procedure; the rule for proving a check can fail lives in engineering.md.
State where a rule's inverse does not generalize, because a new relation can auto-grant on the publishable side while the sensitive side needs no revoke, and a reader will otherwise reason from one to the other.
Anchor: a runtime guard that throws on any query naming a sensitive table, plus a role assertion at the top of every pipeline entry point.
Receipts: `docs/handbook/database.md#give-each-initiative-its-own-least-privilege-role`

## Never let a write script pick its target from a dotfile

Read the connection string for any write path from the exported environment, never from a dotfile some tool loads on your behalf, because permission rules match only the command text and cannot see which database a run resolves to, and an environment runner like direnv is not stripped before that match.
Fail fast when the variable is unset rather than falling back to a default, because a silent fallback writes to the wrong place and still looks like success. A read-only build may load a dotfile; a writer may not.
Anchor: a test asserting the write path throws when the connection variable is absent, and no dotfile loader flag on any script that writes.
Receipts: `docs/handbook/database.md#never-let-a-write-script-pick-its-target-from-a-dotfile`

## Don't

Don't write a down-migration; write the next migration instead.
Don't edit a migration the ledger has already recorded.
Don't number a new migration from the files on disk alone.
Don't regenerate a baseline schema dump from a checkout that is behind the protected branch.
Don't call a migration successful because it exited zero.
Don't run a destructive migration without a backup you could restore.
Don't overwrite a human-asserted provenance from a sync.
Don't infer a link you could have stored.
Don't collapse two roles that differ in the real world.
Don't give machine output its own table merely because a machine writes it.
Don't roll a scoped table forward with a truncate or a migration.
Don't store money in a floating-point column.
Don't compute a fee by arithmetic when the provider records it.
Don't point one initiative's script at another initiative's env file.
Don't rely on a grant alone when the process already holds a privileged role.
Don't generalize a grant rule from one schema to its opposite number.
Don't let a write script read its target database out of a dotfile.

Anchor: every prohibition here is the inverse of a rule above, and is caught by that rule's anchor.
