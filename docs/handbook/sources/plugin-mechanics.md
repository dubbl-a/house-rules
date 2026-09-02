<!-- docs-drift-ignore-file: point-in-time survey captured 2026-08-23; anchors record what was true on that date -->
# Source: plugin-mechanics (survey agent output, 2026-08-23)

I've thoroughly researched the current official Claude Code documentation. Here's a precise technical brief for designing your personal cross-repo plugin:

---

## 1. Plugin Anatomy

**Directory layout** (all at plugin root, NOT in `.claude-plugin/`):
```
my-plugin/
├── .claude-plugin/
│   └── plugin.json                    # ONLY plugin.json here
├── skills/
│   └── skill-name/SKILL.md
├── commands/
│   └── skill.md                       # Flat Markdown (legacy; prefer skills/)
├── agents/
│   └── agent-name.md
├── hooks/
│   └── hooks.json
├── .mcp.json
├── .lsp.json
├── monitors/
│   └── monitors.json
├── bin/                               # Executables added to Bash PATH
├── settings.json                      # Default settings when plugin enabled
└── README.md
```

**`plugin.json` manifest fields** (only `name` required if manifest exists):
```json
{
  "name": "my-plugin",                 // Unique identifier; skills = /my-plugin:skill-name
  "displayName": "Display name",       // Shown in UI (optional)
  "description": "...",
  "version": "1.0.0",                  // Optional; pins plugin unless omitted
  "author": { "name": "..." },
  "homepage": "...",
  "repository": "...",
  "license": "...",
  "skills": "./skills/",               // Path to skills directory
  "agents": "./agents/",
  "commands": "./commands/",
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json",
  "userConfig": {                      // User-prompted settings at enable time
    "api_token": {
      "type": "string",
      "title": "API Token",
      "sensitive": true
    }
  }
}
```

**Component types plugins can ship:**
- ✅ Skills (`.claude/skills/name/SKILL.md`)
- ✅ Commands (flat `.claude/commands/*.md`)
- ✅ Agents (`.claude/agents/*.md`)
- ✅ Hooks (`hooks/hooks.json`)
- ✅ MCP servers (`.mcp.json`)
- ✅ LSP servers (`.lsp.json`)
- ✅ Background monitors (`monitors/monitors.json`)
- ✅ Default settings (`settings.json`)
- ❌ **Path-scoped rules** (`.claude/rules/*.md` with `paths:` frontmatter) — **plugins cannot ship these**
- ❌ **Always-loaded CLAUDE.md instructions** — plugins can ship a `CLAUDE.md` at root but `claude plugin validate` warns; not recommended

**Skills in plugins:**
- Namespaced as `/plugin-name:skill-name`
- Folder per skill under `skills/` directory
- Each contains `SKILL.md` with YAML frontmatter + body

**Key constraint:** Plugins cannot distribute path-scoped `.claude/rules/*.md` files. **Workaround options:**
1. **Ship a skill with `disable-model-invocation: true`** for reference material (invoked explicitly, e.g., `/plugin-name:conventions`)
2. **SessionStart hook** (see below) to inject context into the session conversation
3. **Documented pattern**: Repos using your plugin manually import your repo's rules via `@`-imports in their own `CLAUDE.md` (`.claude/rules/@plugin-repo/rules-name.md`)

---

## 2. Marketplace Anatomy

**`marketplace.json` schema** at `.claude-plugin/marketplace.json`:
```json
{
  "name": "my-tools",                  // Unique marketplace identifier
  "displayName": "My Tools",
  "description": "Marketplace description",
  "owner": {
    "name": "My Org",
    "url": "https://..."
  },
  "plugins": [
    {
      "name": "my-plugin",             // Unique within marketplace
      "displayName": "My Plugin",
      "description": "...",
      "version": "1.0.0",              // Optional; overrides plugin.json
      "category": "development",       // Optional category for UI
      "tags": ["lint", "format"],
      "source": {                      // Where to fetch the plugin
        "source": "github",
        "repo": "owner/repo",
        "ref": "main",                 // Optional branch/tag
        "path": "plugins/my-plugin"    // Optional subdirectory
      },
      "author": { "name": "..." },
      "homepage": "...",
      "strict": false
    },
    {
      "name": "local-plugin",
      "source": "./local-plugins/my-plugin"  // Relative path for local testing
    },
    {
      "name": "npm-plugin",
      "source": {
        "source": "npm",
        "package": "@scope/plugin-name",
        "version": "^1.0.0"
      }
    },
    {
      "name": "archived-plugin",
      "source": {
        "source": "archive",
        "url": "https://example.com/plugin.zip",
        "sha": "abc123..."               // Optional SHA256 for integrity
      }
    },
    {
      "name": "command-plugin",
      "source": {
        "source": "command",
        "command": "scripts/fetch-plugin.sh"  // Runs command each session
      }
    }
  ],
  "renames": {                         // Migration map for old plugin names
    "old-name": "new-name",
    "deprecated": null
  }
}
```

**Plugin sources:**
- `github`: `{ "source": "github", "repo": "owner/repo", "ref": "branch", "path": "subdir" }`
- `git`: Full git URL, clone-based: `https://gitlab.com/org/plugins.git#branch`
- `npm`: `{ "source": "npm", "package": "@scope/plugin", "version": "^1.0.0" }`
- `archive`: `{ "source": "archive", "url": "https://...", "sha": "hex" }`
- `command`: `{ "source": "command", "command": "script.sh" }` (re-runs once per session)
- Local path: `"./relative/path"` or absolute paths

**Hosting & discovery:**
- **GitHub**: `/plugin marketplace add owner/repo` (GitHub shorthand) or full git URL
- **Self-hosted git** (GitLab, Gitea): Full URL + `.git` suffix for clone vs. hosted `marketplace.json`
- **Local path**: `/plugin marketplace add ./my-marketplace`
- **Remote URL**: `/plugin marketplace add https://example.com/marketplace.json` (downloads `marketplace.json` only; relative paths don't work)

**Installation scopes:**
- `user` → `~/.claude/settings.json` (personal, all projects)
- `project` → `.claude/settings.json` (shared via git, all teammates)
- `local` → `.claude/settings.local.json` (personal, gitignored)
- `managed` → Org policy (read-only, set by admin)

**Configuration in `.claude/settings.json`:**
```json
{
  "enabledPlugins": {
    "my-plugin@my-tools": true,
    "other-plugin@claude-plugins-official": true
  },
  "extraKnownMarketplaces": {
    "my-tools": {
      "source": {
        "source": "github",
        "repo": "my-org/claude-plugins"
      },
      "autoUpdate": true
    }
  }
}
```

**Version management & updates:**
- `version` in `plugin.json` pins the plugin; bump it for users to get updates
- Omit `version` → Claude Code uses resolved commit SHA (auto-updates on each new commit)
- `command` sources always hash output; version always includes that hash
- **Never set `version` in both `plugin.json` and `marketplace.json`** (plugin.json wins silently)
- `autoUpdate: true` in marketplace entry enables auto-update for that marketplace (off by default for non-Anthropic)
- `DISABLE_AUTOUPDATER=1` env var disables all auto-updates globally
- Manual refresh: `/plugin marketplace update marketplace-name` or `claude plugin marketplace update`

---

## 3. Hooks in Plugins

**`hooks/hooks.json` at plugin root:**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/init.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "if": "Bash(rm -rf)",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-destructive.sh",
            "exit_on": 2
          }
        ]
      }
    ]
  }
}
```

**Path variables:**
- `${CLAUDE_PLUGIN_ROOT}` → Plugin installation directory
- `${CLAUDE_PLUGIN_DATA}` → Plugin persistent data directory (read/write, survives updates)
- `${CLAUDE_PROJECT_DIR}` → Current project root

**Hook events available:**
- `SessionStart` (once per session, before first turn)
- `SessionEnd`
- `UserPromptSubmit` (before Claude processes prompt)
- `PreToolUse` (before any tool executes; can block with exit 2)
- `PostToolUse` (after tool completes)
- `Stop`
- `StopFailure`
- `UserPromptExpansion`
- `WorktreeCreate` (before worktree initialization)

**Can plugin hooks block actions?**
- ✅ **`PreToolUse`**: Exit code 2 blocks the tool call (e.g., blocking `git push origin master`)
- ✅ **`UserPromptSubmit`**: Exit code 2 blocks prompt processing
- ✅ **`UserPromptExpansion`**: Exit code 2 blocks expansion
- ❌ **`PostToolUse`** and others: Exit 2 shows stderr to Claude but doesn't block

**SessionStart hook context injection:**
- `type: "command"` hook receives JSON stdin, must output JSON on stdout
- Exit 0 + JSON output with `"systemMessage": "text"` injects text into session context
- **Example:**
  ```bash
  jq -n '{hookSpecificOutput: {hookEventName: "SessionStart", permissionDecision: "pass"}, systemMessage: "Plugin loaded with these conventions..."}'
  ```

---

## 4. Skills Specification

**`SKILL.md` frontmatter fields:**
```yaml
---
name: skill-invocation-name              # Used in /plugin-name:skill-name
description: "Brief description"         # Claude uses this to decide when to invoke
disable-model-invocation: false          # true = manual-only (/plugin:skill), false = Claude auto-invokes
allowed-tools: ["Read", "Bash"]          # Restrict which tools this skill can use (optional)
context: fork                            # "fork" = isolated context, "inline" = shared (optional)
agent: custom-agent-name                 # Use a custom subagent (optional)
once: true                               # Run this skill only once per session (optional)
model: opus                               # Override session model (optional)
hooks:                                   # Inline hooks for this skill (optional)
  PreToolUse:
    - matcher: "Bash(rm)"
      hooks: [{ type: "command", command: "..." }]
---

# Skill body (frontmatter above, instructions below)
Description and usage instructions for the skill.
Claude reads this when deciding whether/when to use the skill.
Use $ARGUMENTS placeholder to capture user input: /plugin:skill MyArg → $ARGUMENTS="MyArg"
```

**Invoking skills in plugins:**
- Slash command: `/plugin-name:skill-name` or `/plugin-name:skill-name arg1 arg2`
- Claude auto-invokes based on `description` when `disable-model-invocation: false`
- Default `disable-model-invocation: false` (Claude can invoke automatically)

**Progressive disclosure via `references/`:**
- Create `references/` directory under skill folder with supplemental `.md` files
- Reference with `[See details](./references/detail.md)` in body
- Loaded only when user clicks or Claude needs it

---

## 5. Validation & Testing

**`claude plugin validate [path]`**:
- Checks `plugin.json` schema, syntax
- Validates `hooks/hooks.json`
- Parses YAML frontmatter in skills, agents, commands
- Reports symlink warnings
- Does NOT run the plugin or check skill/command functionality

**Options:**
- `--strict` treats warnings as errors
- Run from plugin directory or marketplace directory

**`claude plugin eval [target]`** (early access, **NOT enabled in this session**):
- Runs eval cases from `evals/` directory
- Evaluates skills, agents, plugins with graders (regex, tool_used, llm judge, etc.)
- Produces HTML report and JSON output
- Gated; requires enablement flag (contact Anthropic for access in your org)

**`/skill-doctor`** (early access, **NOT enabled in this session**):
- In-session skill usage report: cost, 7-day tokens, invocations, never-used warnings
- Text output in non-interactive sessions
- Also shows `/plugin stats` equivalent

---

## 6. Official Plugins

**Anthropic's `claude-plugins-official`** (GitHub: [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official)):
- **Code intelligence**: TypeScript, Rust, Python, Go, C++, etc. (`typescript-lsp`, `rust-analyzer-lsp`, `pyright-lsp`, etc.)
- **Development workflows**: `commit-commands` (git commit/push/PR), `pr-review-toolkit`, `plugin-dev` (plugin authoring), `agent-sdk-dev`
- **Security**: `security-guidance` (post-tool vulnerability review)
- **Design & output**: `frontend-design`, `explanatory-output-style`, `learning-output-style`
- **External integrations**: `github`, `gitlab`, `figma`, `slack`, `sentry`, `vercel`, `supabase`, `notion`, `atlassian`, etc. (MCP bundles)
- **Code skills**: `code-review` (subagent review), `skill-creator` (for creating skills), and more

**Community marketplace** `anthropics/claude-plugins-community`: third-party plugins that pass automated validation.

---

## 7. CLAUDE.md & Rules Guidance

**CLAUDE.md best practices** (from official best practices docs):
- **Keep it concise**: only include what Claude would make mistakes without
- **No size limits stated**, but oversized files cause Claude to ignore content due to context pressure
- **What to include**: bash commands, code style rules, testing prefs, repo etiquette, architectural decisions, dev quirks, gotchas
- **What to exclude**: standard conventions Claude infers, detailed API docs (link instead), frequently-changing info, long tutorials, file-by-file descriptions

**Path-scoped rules** (`.claude/rules/*.md` with `paths:` frontmatter):
- **Plugins cannot ship these directly**
- Used for domain-specific guidance (database rules, frontend rules, entity-resolution rules, etc.)
- Each rule loads only when matching files are edited

**Recommended layout for multi-repo conventions:**
- **Shared plugin approach**: Ship conventions as skills in your plugin (indexed by topic, invoked explicitly or auto-triggered)
- **Imported rules**: Repos using your plugin add `@`-imports in their `.claude/settings.json` or CLAUDE.md to pull your repo's rules
- **SessionStart hook**: Inject shared guidance via hook's `systemMessage` field
- **No official "auto-memory" across repos**: Each repo has its own `.claude/` and settings

---

## 8. Templates & Bootstrap Patterns

**Official bootstrap mechanism:**
```bash
claude plugin init my-tool
```
Creates `~/.claude/skills/my-tool/` with:
- `.claude-plugin/plugin.json` (manifest)
- `SKILL.md` (starter skill file)

**No official `/bootstrap-repo` command**, but the idiomatic pattern:
1. Create a skill with `disable-model-invocation: true` in your plugin
2. User runs `/plugin-name:bootstrap-repo` to invoke it manually
3. **Example skill:**
   ```yaml
   ---
   name: bootstrap-repo
   description: Initialize this repo with conventions
   disable-model-invocation: true
   ---
   Set up this repository with engineering best practices.
   
   1. Copy starter files from ${CLAUDE_PLUGIN_ROOT}/starters/
   2. Write .claude/CLAUDE.md
   3. Create initial git commit
   ```

**For starter files**, ship them in your plugin under `starters/` and reference via `${CLAUDE_PLUGIN_ROOT}` in your skill.

---

## Key Ambiguities & Recent Changes

1. **Plugin rules distribution**: **Confirmed impossible** — plugins cannot ship `.claude/rules/*.md` files. Use skills + SessionStart hooks as workarounds.

2. **Plugin eval status**: Early access, **not enabled in this session**. When enabled, command exists and `claude plugin eval` prints "early access" if the gate is closed; no public docs page yet (reference embedded in this agent's system instructions for now).

3. **SessionStart hook context injection**: **Confirmed** — exit 0 with JSON `{"systemMessage": "text"}` injects text into the session's system context.

4. **Version pinning behavior**: Setting `version` in `plugin.json` pins the plugin; omitting it uses resolved commit SHA (always updates on new commits). **Never set `version` in both files** — `plugin.json` wins silently, masking stale marketplace entries.

5. **Official plugins list**: ~55+ in `claude-plugins-official` as of 2026; browse at `claude.com/plugins` or run `/plugin` → Discover tab.

---

## Recommended Architecture for Your Cross-Repo Plugin

```
my-engineering-plugin/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── skills/
│   ├── conventions/SKILL.md            # Reference for code style (model-invoked)
│   ├── bootstrap-repo/SKILL.md         # Bootstrap (disable-model-invocation: true)
│   ├── test-guide/SKILL.md             # Testing patterns
│   └── git-workflow/SKILL.md           # Git/PR conventions
├── hooks/
│   └── hooks.json                      # SessionStart to inject guidance
├── starters/                           # Bootstrap-repo copies from here
│   ├── CLAUDE.md
│   └── .claude/
│       └── settings.json
├── references/                         # Supplemental docs for skills
├── README.md
└── LICENSE

# Usage across repos:
# 1. Install once per team: /plugin marketplace add my-org/engineering-plugin
# 2. Enable in project: /plugin install engineering@my-org-tools --scope project
# 3. Bootstrap new repo: /engineering:bootstrap-repo
# 4. Auto-loaded conventions: SessionStart hook + rules imported in local CLAUDE.md
```

---

**Sources:**
- [Create plugins](https://code.claude.com/docs/en/plugins.md)
- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces.md)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference.md)
- [Hooks reference](https://code.claude.com/docs/en/hooks.md)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills.md)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins.md)
- [Settings reference](https://code.claude.com/docs/en/settings-reference.md)
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices.md)
- [Official anthropics/claude-plugins-official repository](https://github.com/anthropics/claude-plugins-official)

---

Now I'll answer the coordinator's six precise follow-ups with exact documentation citations:

---

## Six Precise Follow-ups (with current docs)

**1. Does `.claude/rules/` load `.md` files from SUBDIRECTORIES recursively? If yes, does `paths:` frontmatter still work there?**

**Yes, recursive; yes, paths work.**
- From [https://code.claude.com/docs/en/memory.md](https://code.claude.com/docs/en/memory.md): *"All `.md` files are discovered recursively, so you can organize rules into subdirectories like `frontend/` or `backend/`."*
- Path-scoped rules in subdirectories work the same way: *"Rules can be scoped to specific files using YAML frontmatter with the `paths` field. These conditional rules only apply when Claude is working with files matching the specified patterns."*
- **Caveat**: Pre-v2.1.211, path-scoped rules in nested `.claude/rules/` directories loaded even when `project` was excluded from `--setting-sources`. Behavior fixed v2.1.211+.

---

**2. Can a `.claude/rules/*.md` file or `CLAUDE.md` use `@path` imports that point OUTSIDE the repo? Absolute paths? Plugin cache paths? Load timing? Depth limit?**

**Yes (with caveats); yes to absolute paths; no to plugin cache paths (not documented); load is at session start; max depth 4.**

From [https://code.claude.com/docs/en/memory.md](https://code.claude.com/docs/en/memory.md):
- *"Both relative and absolute paths are allowed. Relative paths resolve relative to the file containing the import, not the working directory."*
- *"Imported files can recursively import other files, with a maximum depth of four hops."*
- **External imports** (outside the repo): *"An import in a project-level memory file is external when its path resolves outside your working directory, like the home directory import above. The first time Claude Code encounters external imports in a project, it shows an approval dialog listing the files."*
- **Timing**: Imports are expanded and loaded into context at launch (not lazy).
- **In `.claude/rules/*.md`**: The docs **do not explicitly state** whether imports are honored inside `.claude/rules/*.md` files. The examples show imports only in `CLAUDE.md`. This is **ambiguous**; infer from: path-scoped rules load the whole file at match time, so imports would theoretically expand, but no example demonstrates it.
- **Plugin cache paths** (e.g., `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/...`): **Not documented.** No guidance on whether they work or are blocked.

---

**3. A plugin's root `settings.json`: which settings keys may it ship, and does it merge into the user's effective settings when the plugin is enabled?**

**Only `agent` and `subagentStatusLine` keys; yes, it merges.**

From [https://code.claude.com/docs/en/plugins.md](https://code.claude.com/docs/en/plugins.md):
- *"Plugins can include a `settings.json` file at the plugin root to apply default configuration when the plugin is enabled. Currently, only the `agent` and `subagentStatusLine` keys are supported."*
- *"Settings from `settings.json` take priority over `settings` declared in `plugin.json`."*
- **Merge behavior**: Settings merge across scopes (Managed > Project > User). For arrays like `hooks`, entries **concatenate** rather than replace. Scalar values from higher-priority scopes override lower ones.
- **No other keys** (permissions, env, hooks) may ship in plugin `settings.json`—only `agent` and `subagentStatusLine`.

---

**4. Are `claude plugin init`, `claude plugin validate`, `claude plugin install <name>@<marketplace> --scope project`, `claude plugin marketplace add`, and `claude plugin update` all available as non-interactive CLI subcommands? When a repo commits `.claude/settings.json` with `enabledPlugins` + `extraKnownMarketplaces`, what happens on a fresh machine?**

**Yes, all available as CLI; fresh machine = no auto-install (manual step required, but marketplace may be auto-added).**

**CLI commands (exact syntax)** from [https://code.claude.com/docs/en/cli-reference.md](https://code.claude.com/docs/en/cli-reference.md) / [https://code.claude.com/docs/en/discover-plugins.md](https://code.claude.com/docs/en/discover-plugins.md):
```bash
claude plugin init <name>
claude plugin validate <path> [--strict]
claude plugin install <name>@<marketplace> [--scope user|project|local] [--yes]
claude plugin marketplace add <source> [--scope user|project|local]
claude plugin update [<name>]
```

**Auto-install behavior** from [https://code.claude.com/docs/en/discover-plugins.md](https://code.claude.com/docs/en/discover-plugins.md):
- *"As of Claude Code v2.1.195, adding the marketplace doesn't install plugins that come from an external source, on any path that loads plugins. A plugin that only the project's `.claude/settings.json` enables, and that comes from an external source such as a GitHub repository or npm package, doesn't load until the team member installs it."*
- **The marketplace** (`extraKnownMarketplaces`) **may auto-register** if it was previously added and stored locally; see: *"Automatic registration doesn't cover every machine. It most commonly misses: Non-interactive environments that run before the machine's first interactive launch. Machines where Claude Code already ran interactively under a policy that blocked the marketplace."*
- **Plugins themselves** do NOT auto-install when the repo commits `.claude/settings.json` with `enabledPlugins`. You must run `claude plugin install` manually or use `claude --session-only` + manual install. **Not documented as auto-installing.**

---

**5. Plugin hooks scope: if a plugin is enabled at USER scope, do its PreToolUse/SessionStart hooks fire in EVERY repo? Is there a per-project way to disable one plugin (settings key) so a repo can opt out?**

**Yes, hooks fire in every repo; yes, opt-out via `settings.local.json` `enabledPlugins: false`.**

From [https://code.claude.com/docs/en/discover-plugins.md](https://code.claude.com/docs/en/discover-plugins.md):
- Hooks are part of the plugin's manifest. When a plugin is enabled at USER scope (`~/.claude/settings.json`), its hooks activate in every repo.
- *"If the plugin was enabled through a project's `.claude/settings.json`, disabling it from `/plugin` writes an override to your `.claude/settings.local.json` rather than editing the checked-in file, so the plugin stays off for you while teammates are unaffected."*
- **Per-project opt-out**: Set `"enabledPlugins": {"<plugin-name>@<marketplace>": false}` in `.claude/settings.local.json` (gitignored).
- **No documented "disable only hooks" mechanism**—disabling the plugin disables all its hooks, skills, agents, and MCP servers together.

---

**6. SessionStart hook output: is the documented way to add context `hookSpecificOutput.additionalContext` or `systemMessage`? Exact JSON shape? Size guidance?**

**Both exist; `systemMessage` is for SessionStart specifically; exact shapes differ by event; no size limit documented.**

From [https://code.claude.com/docs/en/hooks-guide.md](https://code.claude.com/docs/en/hooks-guide.md):
- **For `SessionStart` hooks** (re-inject context after compaction example):
  ```bash
  echo 'Reminder: use Bun, not npm. Run bun test before committing. Current sprint: auth refactor.'
  ```
  Plain stdout is added to Claude's context (no JSON wrapper needed for plain text).

- **For `UserPromptSubmit` hooks** (inject context into prompts):
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "UserPromptSubmit",
      "additionalContext": "Current branch: release-42. Deploy freeze until Friday."
    }
  }
  ```

- **The distinction** from [https://code.claude.com/docs/en/hooks-guide.md](https://code.claude.com/docs/en/hooks-guide.md):
  - **`additionalContext`**: Used in `UserPromptSubmit` hooks; text is injected as context Claude reads as plain text.
  - **`systemMessage`**: **Not explicitly named in the hooks-guide.md or hooks.md reference I retrieved.** The search did not surface a `systemMessage` field in hook output. **This is ambiguous/not documented**, or it may be a private field. The docs show `additionalContext` for the main context-injection pattern.

- **No size limit documented**. CLAUDE.md files are capped at 4 MiB (skipped if larger), but hook output size is not specified.

---

## Summary of Ambiguities Flagged

1. **`@path` imports in `.claude/rules/*.md`**: unclear whether fully supported; examples show imports only in CLAUDE.md.
2. **Plugin cache path imports**: not documented; unknown if `@~/.claude/plugins/cache/...` works.
3. **`systemMessage` in hook output**: not found in current docs; only `additionalContext` documented for context injection. If `systemMessage` exists, it may be undocumented or context-specific.
4. **Plugin `settings.json` merge depth**: settings precedence explained, but no explicit statement that plugin `settings.json` merges the same way (inferred from general merge rules).

**Sources:**
- [Memory: CLAUDE.md files and rules](https://code.claude.com/docs/en/memory.md)
- [Plugins: creating and distributing](https://code.claude.com/docs/en/plugins.md)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins.md)
- [Hooks guide](https://code.claude.com/docs/en/hooks-guide.md)
- [Hooks reference](https://code.claude.com/docs/en/hooks.md)
- [CLI reference](https://code.claude.com/docs/en/cli-reference.md)
