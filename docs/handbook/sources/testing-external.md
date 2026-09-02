<!-- docs-drift-ignore-file: point-in-time research captured 2026-08-24; recovered from the workflow journal after a template-literal bug kept it from reaching the spec stage -->
# Source: testing-external (research agent output, 2026-08-24)

# Testing and QA for a solo dev with AI coding agents: research findings

Rules below are ready to become a ~150-line rule file. Format: **RULE** + why + source + tag.

## 1. Tests are the agent's verification loop

**Give every task a check the agent can run itself: tests, a build exit code, a linter, a diff-against-fixture script, or a screenshot compare.** Without one, "looks done" is the only signal the agent has and you become the verification loop. https://code.claude.com/docs/en/best-practices [official]

**Escalate how hard the check gates the stop: in-prompt ("run the tests and iterate") for one task, a `/goal` condition across a session, a Stop hook when it must be deterministic.** Each step trades setup for attention; only the last two let an unattended run finish correctly. https://code.claude.com/docs/en/best-practices [official]

**Demand evidence, not assertion: the command run, its output, the exit code.** Reviewing evidence is faster than re-running the check, and it works for sessions you were not watching. https://code.claude.com/docs/en/best-practices [official]

**Never claim passing, fixed, or complete without having run the verifying command in that same message.** Confidence is not evidence, and a prior run does not certify the current tree. https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md [opinion]

**Have a fresh-context subagent review the diff against the plan, and tell it to report only correctness and requirement gaps.** The writer is biased toward its own code, and a reviewer told to find problems will invent them if not scoped. https://code.claude.com/docs/en/best-practices [official]

**Put verification criteria in the prompt as concrete cases, not adjectives.** "validateEmail: user@example.com true, user@.com false, run the tests" beats "validate emails". https://code.claude.com/docs/en/best-practices [official]

## 2. TDD with an agent

**State test-first explicitly; agents default to implementation-first.** "Write a FAILING test for X. Do not write implementation yet." https://code.claude.com/docs/en/best-practices [official]

**Watch the test fail before writing code, and confirm it failed for the intended reason (feature missing, not a typo or import error).** If you never saw it fail, you have not proved it can catch the bug. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md [opinion]

**Commit the failing test as a checkpoint, then instruct: do not modify the tests, keep going until they pass.** Otherwise the cheapest path to green is weakening the assertion. [widely-held; the strong form is opinion] https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md

**Treat "the test passed on the first run" as a red flag, not a win.** It means you are testing behavior that already existed. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md [opinion]

**For a bug fix, write the reproducing test first and verify red-green by reverting the fix.** A regression test that has never failed is decoration. https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md [opinion]

## 3. What makes a test worth keeping

**Before writing the body, name the production change that would make this test fail.** Cannot name one: the test catches nothing. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/writing-good-tests.md [opinion]

**Derive expected values by hand as literals; never compute them with the code under test or its helpers.** A mirror assertion passes no matter what the code does. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/writing-good-tests.md [opinion]

**Ban change detectors: do not assert a constant's value or exact private structure; assert the behavior that depends on it.** They fire on every redesign and sleep through real bugs. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/writing-good-tests.md [opinion]

**Never assert on a mock's behavior.** A mock assertion passes when the mock is present and says nothing about your component. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/writing-good-tests.md [opinion]

**Mock only the slow or external operation; keep everything the assertion depends on real.** Over-mocking swallows the side effect the test exists to observe. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/writing-good-tests.md [opinion]

**Do not test the framework, constructors, getters, or trivial forwarding.** Test the contract at your boundary: the route registered, the query emitted, the payload produced. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/writing-good-tests.md [opinion]

**Judge each test against Beck's desiderata; the ones that matter most solo are specific (failure cause obvious), deterministic, structure-insensitive, and behavioral.** Structure-insensitive plus behavioral is exactly what lets an agent refactor without you. https://testdesiderata.com/ [widely-held]

**Test one behavior per test, not one assertion per test; use Arrange/Act/Assert or given/when/then.** Multiple assertions on one behavior are fine; two behaviors need two names. https://martinfowler.com/articles/practical-test-pyramid.html [widely-held]

**Name the test as unit-of-work + state + expected behavior; an "and" in the name means split it.** The name is the failure message you read at 11pm. https://osherove.com/blog/2005/4/3/naming-standards-for-unit-tests.html [opinion]

## 4. Suite shape and budget

**Write lots of fast unit tests, some integration tests, very few end-to-end.** Higher tests are slower, flakier, and worse at localizing a failure. https://martinfowler.com/articles/practical-test-pyramid.html [widely-held]

**When a high-level test catches a bug and no low-level test fails, add the low-level test.** Push every test as far down as it will go. https://martinfowler.com/articles/practical-test-pyramid.html [widely-held]

**Delete higher-level tests whose cases are already covered below.** Duplicate coverage costs maintenance and buys nothing. https://martinfowler.com/articles/practical-test-pyramid.html [widely-held]

**Keep the gating CI suite inside a ten-minute build with slow dependencies replaced by fakes; leave long pipelines, real-network tests, and full data runs local or nightly.** A build slower than the coffee break gets bypassed. https://martinfowler.com/articles/continuousIntegration.html [widely-held]

## 5. Snapshot and golden files

**Commit snapshots and read every diff in review like code.** The failure mode is regenerating on failure instead of examining the cause. https://jestjs.io/docs/snapshot-testing [official]

**Never let an agent run the update flag unprompted; require it to show the diff and explain each changed line before blessing it.** An agent that can rewrite the oracle has no oracle. [opinion, extends the Jest guidance above]

**Keep snapshots short and focused; lint against large ones.** A 500-line snapshot is unreviewable, so it will be blessed blind. https://jestjs.io/docs/snapshot-testing [official]

**Strip nondeterminism (clocks, IDs, paths, ordering) before snapshotting.** You own making the output stable. https://jestjs.io/docs/snapshot-testing [official]

**Snapshots supplement assertions; they never replace them.** They detect drift, they do not state intent. https://jestjs.io/docs/snapshot-testing [official]

## 6. Property-based and mutation testing

**Reach for property-based tests where a property is obvious: round-trips (encode/decode, parse/serialize), invariants (nothing is lost), and comparison against a slow reference implementation.** Round-trips are both powerful and cheap to write. https://hypothesis.readthedocs.io/en/latest/tutorial/introduction.html [official]

**Skip property testing when you cannot state a property in one sentence.** Finding the property, not running the generator, is the hard part, and random data without a shaped generator tests nothing interesting. https://www.hillelwayne.com/post/contract-examples/ [opinion]

**Pin the seed or the example database so a property failure is reproducible.** An unreproducible failure is a flake. https://hypothesis.readthedocs.io/en/latest/tutorial/introduction.html [official]

**Run mutation testing rarely and narrowly: on the two or three modules where a silent wrong answer would be worst, on changed files, nightly rather than per-PR.** It is the only metric that answers "would my tests fail if the code were wrong", but full runs are too slow to gate on. https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/ [official]

**Read surviving mutants as a worklist, not a score to raise.** The value is the specific untested branch it names.

## 7. Flakiness

**Quarantine a nondeterministic test immediately, cap the quarantine (about 8 tests or one week), and delete what you cannot fix.** Tolerated flakes teach you to ignore failures, and then real failures get ignored too. https://martinfowler.com/articles/nonDeterminism.html [widely-held]

**Never add a retry to make a test green.** A retried pass is flake telemetry, not evidence of health, and marking a test flaky discards actionable information. https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html [widely-held]

**Replace every sleep with a wait-for-condition helper that has a timeout and a description; a bare timeout needs a comment justifying the number.** Arbitrary delays pass on your laptop and fail under load. https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/condition-based-waiting.md [opinion]

## 8. Coverage honesty

**Use coverage to find untested code, never as a target or a claim of quality.** Make it a target and it will be hit with worthless tests. https://martinfowler.com/bliki/TestCoverage.html [widely-held]

**Judge sufficiency by two questions: do bugs escape to production, and do you change code without fear.** Percentages answer neither. https://martinfowler.com/bliki/TestCoverage.html [widely-held]

**Be suspicious of 100 percent.** It usually means tests written to satisfy the metric. https://martinfowler.com/bliki/TestCoverage.html [widely-held]

## 9. Scripts, CLIs, hooks and guards

**Test scripts by running them against controlled inputs and asserting stdout, exit codes, and side effects; never assert that a file contains a line of text.** Asserting source text proves only that the source is the source. https://github.com/obra/superpowers/blob/main/skills/test-driven-development/writing-good-tests.md [opinion]

**Use a real shell harness (bats-core) with per-test temp dirs and setup/teardown for bash tooling.** Each test runs in its own process, so isolation is structural. https://bats-core.readthedocs.io/en/stable/writing-tests.html [official]

**Test a hook by piping a captured real payload into the real script and asserting the exit code.** Hook semantics are non-obvious (0 = no decision, 2 = block, 1 = does not block), so a test that re-implements the logic will agree with a broken hook. https://code.claude.com/docs/en/hooks [official]

**Never re-implement a guard's logic inside its test; import or exec the real module.** A parallel implementation tests the copy, not the guard.

**Treat hooks as advisory plus enforcement, not a security boundary: they can time out, run in parallel, and be cancelled.** Pair them with permission rules for anything that matters. https://code.claude.com/docs/en/hooks [official]

**Validate at every layer data passes through rather than at the one place the bug appeared.** Different paths, refactors, and mocks each bypass a different single check. https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/defense-in-depth.md [opinion]

## 10. Fixtures, factories, and the known-answer control

**Prefer factories with a minimal valid default plus per-test overrides over large static fixture files.** Static fixtures push complexity out of the test, and tests silently couple to fixture rows. https://github.com/thoughtbot/factory_bot [widely-held]

**Keep a factory's baked-in defaults to the minimum valid record; push situational values to the call site or a named trait.** Bloated factories make tests slow and brittle. https://github.com/thoughtbot/factory_bot [widely-held]

**Give shared fixtures names that carry meaning (Object Mother) so the test reads as a scenario.** https://martinfowler.com/bliki/ObjectMother.html [widely-held]

**Every gate ships with a known-answer control: a fixture that MUST trip it, asserted in CI.** A checker that always reports zero problems is indistinguishable from a checker that is broken; the red-green revert cycle is the same idea applied to one test. https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md [opinion]

**Prove a gate can fail before trusting a pass: revert the fix, see red, restore, see green.** https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md [opinion]

---

## Where sources DISAGREE

1. **Strict TDD vs tests-after.** obra/superpowers states an Iron Law: no production code without a failing test, and delete code written before its test. Anthropic's current docs are weaker and mostly agnostic: they require *a check the agent can run*, not test-first, and their own recipes include "add tests for the notification service" after the fact. Fowler treats TDD as valuable but not a moral rule. Solo, the superpowers position is the most expensive and the most defensible; the docs position is what most people actually do.

2. **Delete-and-restart after writing code first.** Superpowers says delete it, do not even keep it as reference. Nobody official endorses this. It is a discipline heuristic, not evidence-backed.

3. **Mocking.** Fowler explicitly declines to arbitrate solitary vs sociable unit tests and says both work. Superpowers is firmly anti-mock ("real code, mocks only if unavoidable"). Anthropic's docs show "avoid mocks" only as an example of a *user preference* to state, not a recommendation.

4. **Retries in CI.** Fowler and Google's testing blog say retries hide root causes and marking a test flaky discards information. A large body of practitioner writing says 1 to 2 retries are legitimate as flake *telemetry* while keeping deploys unblocked. The disagreement is about whether a retried pass is ever allowed to be the final signal.

5. **The pyramid's shape.** Fowler's pyramid remains the default, but there is a live counter-tradition (testing trophy, honeycomb, "pyramid or crab") arguing the integration layer should be the fattest for modern service-shaped code. Nobody disputes that end-to-end should be thin.

6. **Coverage numbers.** Fowler says never make coverage a target and be suspicious of 100 percent. Mutation-testing advocates counter that coverage is not too strict but too weak, and that a mutation score IS a defensible target. They agree that line coverage is not a quality measure; they disagree on whether any number should gate.

7. **Fixtures vs factories.** The factory_bot lineage treats static fixtures as an antipattern; the Rails core and several practitioners argue fixtures are faster and that factories cause slow suites through cascading associations. Both agree the failure mode is the same: shared test data nobody reads.

8. **Test naming.** Osherove's three-part convention vs Fowler's "find terms that work for you and be consistent". No authority mandates a format.

9. **One assertion per test.** Widely repeated as folklore, but the sources that examine it (including Fowler) land on one *behavior* per test with as many assertions as that behavior needs.

Word count: ~1,470.
