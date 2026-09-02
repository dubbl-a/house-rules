# Authoring skills in this repo

Conventions for `.claude/skills/*`, following Anthropic's Agent Skills guidance
(source of truth: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

## Layout

- **One folder per skill**, named lowercase-hyphen (gerund preferred, e.g. `analyzing-x`; a noun
  phrase is acceptable too). Never use the reserved words "claude" or "anthropic".
- **`SKILL.md` is the entry point**: YAML frontmatter (`name`, `description`) plus a concise body.
  `name` must equal the directory name.
- **Bundle detail in subfolders, loaded on demand** (progressive disclosure):
  - `references/*.md` — docs Claude reads only when it needs them.
  - `scripts/` — utility scripts Claude executes (only their output enters context).
  - `assets/` — templates and binaries.

## SKILL.md rules

- **Frontmatter.** `name` ≤ 64 chars, lowercase/digits/hyphens only. `description` ≤ 1024 chars,
  written in the third person, saying both what the skill does and when to use it, with the key
  trigger phrases a user would say.
- **Body under 500 lines.** When it grows past that, move detail into `references/`, don't append.
- **References one level deep.** Link reference files directly from `SKILL.md`; never chain
  reference to reference — a nested file gets partially read, so content past the cut is missed.
- **Reference files over 100 lines open with a table of contents**, so a partial read still shows
  scope.
- **Forward-slash relative paths**; descriptive filenames (`exploration-playbook.md`, not `doc2.md`).
- **A default with an escape hatch, not a menu** of options. Keep prose concise; assume the reader
  is smart.
- **No time-sensitive facts** ("as of <date>", a version number, a one-off measured result) in the
  method itself — that belongs in a dated doc the skill can point to, not in the skill.

## When you change a skill

Skills are docs: follow this repo's branch-and-PR workflow, and the docs check must pass — it
<!-- docs-drift-ignore: illustrative placeholder, not a real anchor -->
verifies that a backticked path like `.claude/...` resolves to something real. Skills aren't
runtime code, so changing one needs no deploy.
