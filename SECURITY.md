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

## Out of scope

A report about a consuming repo's own `house.json` (a permissive `branchPolicy`, a disabled
module, a carve-out) is a configuration choice for that repo to own, not a vulnerability in this
package.
