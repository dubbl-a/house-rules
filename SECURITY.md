# Security Policy

## Supported versions

Only the latest published minor release line receives security fixes. The version currently
running for a given repo is `house.json`'s `version` field; the version the plugin is at is
`plugins/house/.claude-plugin/plugin.json`. There is no back-patching of older minors: upgrade by
installing the latest plugin and running `/house-rules:sync`.

## Reporting a vulnerability

Report privately through this repository's GitHub private vulnerability reporting: open the
Security tab and use "Report a vulnerability." Do not open a public issue for a suspected
vulnerability.

We aim to acknowledge a report within a week. This project has no formal SLA beyond that;
maintenance is a side project, not a funded security function.

## Scope and threat model

house-rules ships prose rule files, a checker script (`plugins/house/payload/check.mjs`), a
branch-guard shell hook (`plugins/house/hooks/`), and Claude Code skills that run in a
contributor's or an adopter's own shell. There is no network service here and no runtime this
package operates: nothing in this repo listens on a port, holds a credential, or runs unattended.

The realistic threat is a malicious change to a rule, a hook, or a script that ends up running on
an adopter's machine after a `/house-rules:sync`, either through a compromised contribution to
this repo or a compromised install. Report that class of finding, along with any way the
checker's tamper detection, the branch guard, or the plugin manifest can be made to misrepresent
what it is protecting.

The mitigations already in place: `.house/lock.json` records a SHA-256 hash of every managed
file's body, so a tampered vendored file is caught by `npm run check:house`'s tamper family; a
sync only ever writes after a human reads the plan `/house-rules:sync` prints and approves it
(`plugins/house/skills/sync/SKILL.md`); and every change to the package itself goes through the
branch-and-PR workflow described in `CONTRIBUTING.md`, reviewed before merge. There is no other
runtime protection because there is no other runtime.

### The plugin-update path

A sync is not the only way new code arrives. The plugin's hooks run unsandboxed with the adopter's
access, and they change when the plugin updates, with no sync and no diff to approve. Auto-update is
off by default for third-party marketplaces; where it is turned on, it delivers hook changes. The
install prompt shows that a hook exists but not what it runs, and Claude Code does not document
whether an update that changes hooks asks again, so assume it does not. Mitigation: pin the
marketplace to a release tag (`claude plugin marketplace add dubbl-a/house-rules#v0.17.0`), and
read the hooks diff between tags (`git diff vA..vB -- plugins/house/hooks`) before moving the pin.
Whether auto-update follows or respects a pin is also not documented.

Tags `v0.16.0` and `v0.17.0` are annotated and unsigned, and `v0.15.2` and older are lightweight.
From the release after `v0.17.0`, a release is immutable on GitHub (its tag and assets cannot be
changed once published) and its tag is signed with Sigstore's gitsign under the maintainer's GitHub
identity (`CONTRIBUTING.md`, "Cutting a release"). GitHub shows such a tag as unverified because it
does not check Sigstore signatures. Verify one in a clone with
`gitsign verify-tag --certificate-identity-regexp '\+dubbl-a@users\.noreply\.github\.com$' --certificate-oidc-issuer https://github.com/login/oauth vX.Y.Z`,
or check the release itself with `gh release verify vX.Y.Z`.

### For an organization

A managed-settings allowlist can admit only this marketplace at a tag:

    {"strictKnownMarketplaces":[{"source":"github","repo":"dubbl-a/house-rules","ref":"v0.17.0"}]}

Three caveats from Claude Code's docs (https://code.claude.com/docs/en/plugins/org#how-entries-match):
the `repo`, the `ref`, and the `path` must all match or be absent on both sides, and the entry
matches the marketplace, not a plugin inside it; an allowlist also needs `{"source":"skills-dir"}`
or skills-directory plugins stop loading; and an empty list blocks the official marketplace too.
Auto-update is off by default for third-party marketplaces and turns on per marketplace in
`/plugin`, or with `"autoUpdate": true` on a managed `extraKnownMarketplaces` entry
(https://code.claude.com/docs/en/plugins/loading#when-auto-update-runs).

## Out of scope

A report about a consuming repo's own `house.json` (a permissive `branchPolicy`, a disabled
module, a carve-out) is a configuration choice for that repo to own, not a vulnerability in this
package.
