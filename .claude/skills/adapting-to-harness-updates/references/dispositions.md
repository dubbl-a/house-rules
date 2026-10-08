# Dispositions

The five classes every survey uses, and what each one obliges. They match the enums in the
workflow scripts, so a hand triage and a workflow run produce comparable records.

| Disposition | Test | Action |
| --- | --- | --- |
| DUPLICATE | The harness already does what the rule asks, with equal or stronger enforcement, so the rule adds nothing beyond restating it. | Retire it, or keep it as a declared duplicate that names the native floor and says what the house version still adds (a gate, a scope, a check that runs where the native one does not). |
| CONFLICT | The rule contradicts documented harness behavior, or fights a native mechanism, for example by telling the assistant to do by hand what the harness now does automatically. | Resolve it in the rule or hook. A resolution that renames a heading, a slot, or a hook contract is the breaking class under ADR 0011 and ADR 0012. |
| COMPLEMENT | The rule builds on a native primitive and adds posture, scope, or enforcement the harness lacks. | Keep it. Reword to cite the native floor only where the rule claims or implies one. |
| UNIQUE | The facts show no native counterpart. | Keep it and record it. This is the package's reason to exist. |
| OPPORTUNITY | The release adds something the package should adopt (use in a hook, agent, workflow, template, or checker), teach (a rule clause an adopter would act on), or retire a house mechanism in favor of. | Size it. Small (a rule clause, an Anchor or receipt update, a template or settings line, a checker list constant): apply in the same PR, refute, and release it. Larger (a new hook or event, a guard, agent, or workflow-fork change, a new checker family): build it in the same PR with its tests, refute it until clean, and name it as larger in the PR body. Anything that would weaken a guard, loosen a deny, or edit `.github/workflows/` is a proposal in the PR body, never applied. |

A finding can be COMPLEMENT and OPPORTUNITY at once; list it under both.

## Verification lenses

A DUPLICATE or CONFLICT claim is confirmed only when neither skeptic refutes it. If one refutes it,
downgrade to that skeptic's `downgradeTo`, or to COMPLEMENT when the skeptics disagree.

- **Doc accuracy.** Fetch the cited page or run the cited command. Refute when the source does not
  say what the claim asserts, at the scope asserted.
- **Enforcement reality.** A docs recommendation or a warning does not make a blocking or
  mechanical house rule redundant. A feature scoped to one surface does not cover a rule about
  another. Refute when the house rule still adds enforcement, scope, or posture.

## Prompt-audit findings

These fall outside the five classes. They grade the wording of a rule against the current model,
not the rule's relation to the harness. Treat each one as a candidate reword with three checks:
- the rule's claim stays the same;
- the checker's rule shape still holds (imperative heading, `Anchor:`, `Receipts:`, a closing
  `## Don't`);
- a length ceiling is not raised to fit.

When a flag lands on the shape itself, raise it with the user as a package decision.
