<!-- docs-drift-ignore-file: receipts chapter; dates, CVE ids, versions, and outside URLs are the point -->
# Security

## Why this exists

An agent session reads text written by strangers, installs what it is told to, runs hooks and servers with the full access of whoever opened the repo, and writes code that fails security tests often enough to measure. The 2025 and 2026 incidents behind this module did not need a novel exploit: an issue title steered a CI agent into installing from an attacker's fork, a repo's own config file ran commands or redirected an API key once the folder was trusted, and two supply-chain compromises ended in a long-lived publish token being used by someone else. This chapter is the evidence behind each rule in the module's two rule files: `plugins/house/modules/security/rules/security.md` holds the agent and supply-chain rules, and `plugins/house/modules/security/rules/security-server.md` the server-code rules.

The module is opt-in: `house init` leaves it off, and a repo whose `house.json` predates it has no key for it, which render also reads as off, so a resync never adds it. A repo turns it on with `/house-rules:bootstrap`, which runs `house enable security`: one plan showing the paths the module's slots resolve to there, the files render would write, the lines it adds to each path against the co-load ceiling, and the at-adoption checklist from the module's `atAdoption` steps (code scanning and dependency alerts, branch protection with required checks, a code-owners entry, and the credential deny list in each developer's user settings). Nothing is written until the plan is approved and re-run with `--apply`, which writes `house.json`, renders, and runs the checker. `house disable security` reverses it the same way: it removes the module's managed files and keeps its config and confirmations, so enabling it again lands where it was. Each file has its own paths, so the half that loads on every code file stays short: `security.md` loads on the `securityAgentRoots` slot (the agent settings and hooks, `.mcp.json`, `package.json`, and the workflows), `security-server.md` on the `securityRoots` slot (the code roots), and both on `securityGlobs`. Narrowing those slots narrows where each loads; a repo that set `securityRoots` before the split keeps loading the server-code rules there.

The rules rest on two kinds of evidence, and each section says which. The first is one deep-research run on 2026-10-03 that fanned out across five angles, fetched 22 sources, extracted 96 claims, and put the top 25 to a three-voter adversarial check: 22 were confirmed and 3 refuted, with none left unverified. Where a vote was split it is given below. That run's caveats apply throughout: most sources are vendors describing their own products, which is the right evidence for how a product behaves but goes stale quickly, so a harness setting named here should be rechecked by the harness-watch pipeline when Claude Code ships. The second is the published standards in the coverage map below (OWASP, NIST, OpenSSF, CIS), read on the same day. The incidents explain why the agent-facing rules exist; the standards are what the application-code rules and the widened parts of the others rest on, and a section that leans on a standard rather than an incident verified in this cycle says so.

Each rule states a principle meant to outlive its incident, so dated specifics (a harness default, a fix version, a vote) live here and not in the rule file. Workflow permissions, action pins, branch protection, and where credentials live are `github.md`'s rules, and the committed allowlist is `claude-code.md`'s; the evidence here that also bears on those is recorded at the end for the next pass over `github.md`.

## How this chapter stays current

Check a new incident against the coverage map first. If its class is already covered, it becomes evidence under the covering rule's section here, and the rule file is left alone; only an incident whose class the map marks uncovered, or left out with a reason the incident overturns, is a case for a new rule or a changed verdict.

## Treat every input to the model as data, never as instructions

Clinejection is the whole chain in one incident (confidence high; votes 3-0, 2-1, 3-0 on its three parts). Cline's issue-triage workflow ran `claude-code-action` with Bash and Write tools and interpolated `${{ github.event.issue.title }}` into the agent's prompt with no delimiting or sanitization. An injected title made the agent run `npm install` from an attacker's fork; a preinstall script deployed Cacheract, which evicted and poisoned the Actions cache; the nightly release workflow restored the poisoned cache, which leaked the npm, VS Code Marketplace, and OpenVSX tokens. On 2026-02-17 the unrevoked npm token was used to publish `cline@2.3.0`, live about 8 hours with about 4,000 downloads. Two corrections from the verifiers: the title went into the task prompt, not the system prompt, and the researcher's proof of concept ran on a mirror, with a different actor using it against Cline. Sources: https://labs.cloudsecurityalliance.org/research/csa-research-note-clinejection-prompt-injection-cicd-cache-p/ (secondary), corroborated by the researcher's primary write-up at https://adnanthekhan.com/posts/clinejection/ and Cline's advisory GHSA-9ppg-jx86-fqw7. The rule's CI sentence is that incident's first lesson.

OpenAI's Codex documentation states the session-side half directly: treat web results as untrusted. Codex's web search uses a cached index by default and switches to live results under `--yolo` or full access, which the docs say raises prompt-injection exposure (confidence high, 3-0; https://developers.openai.com/codex/agent-approvals-security, now at learn.chatgpt.com/docs/agent-approvals-security).

The widened list (a memory note, a rule file from an unreviewed source, another agent's message) and the sentence on writing to memory rest on the OWASP Top 10 for Agentic Applications 2026, not on an incident verified in this cycle (https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/). ASI01 Agent Goal Hijack is the injected-instruction class. ASI06 Memory and Context Poisoning covers context an agent "retains, retrieves, or reuses," where adversaries "corrupt or seed this context with malicious or misleading data, causing future reasoning, planning, or tool use to become biased, unsafe, or aid exfiltration," and names peer-agent exchanges among the untrusted ingestion sources. ASI07 Insecure Inter-Agent Communication is the message-from-another-agent case. LLM01 Prompt Injection in the LLM Top 10 is the same class one level down (https://genai.owasp.org/llm-top-10/).

No verified claim in the research run covers how Claude Code itself treats the content of a tool result.

## Give an agent, a key, and a token only what one task needs

The credential half comes from the harness's own documentation, verified 3-0 in the research run, and is dated evidence because the rule no longer names the settings. As of 2026-10-03, Anthropic's sandboxing page says, verbatim, "There is no built-in credential deny list, so only the files and variables you list are restricted." Even with the sandbox on, sandboxed commands can by default read most of the machine, including `~/.ssh` and `~/.aws/credentials`, and inherit environment secrets. The listed mitigations are `sandbox.credentials` entries for `~/.ssh` and `~/.aws`, `permissions.blockReadsOutsideWorkingDirectories`, and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, and the same page's security checklist tells users to add the `~/.aws` and `~/.ssh` entries. Credential entries must sit in user or managed settings: project and local settings ignore them as of v2.1.246, so a vendored repo file cannot carry this control, which is why the rule sends it to the onboarding doc. Source: https://docs.claude.com/en/docs/claude-code/sandboxing (now https://code.claude.com/docs/en/sandboxing).

The egress sentence comes from a warning box on the same page (confidence high, 3-0). The sandbox proxy starts with an empty allowlist and decides from the client-supplied hostname without inspecting TLS, so allowing a broad domain such as `github.com` opens paths for exfiltration and domain fronting. In `bypassPermissions` mode, hosts outside the list are allowed unless `strictAllowlist` or `allowManagedDomainsOnly` is set. The experimental `network.tlsTerminate` setting masks credentials only and does not filter content. These docs cite versions up to v2.1.246, and where credential entries are honored changed recently, so this paragraph and the one above are the first to recheck on a harness release.

The general principle (scope every grant to one job, prefer a per-run identity, remove a grant when its task ends) rests on standards, not on an incident verified in this cycle. Saltzer and Schroeder's least privilege is the oldest statement of it (https://web.mit.edu/Saltzer/www/publications/protection/Basic.html). OWASP's ASI02 Tool Misuse and Exploitation covers an agent that "operates within its authorized privileges but applies a legitimate tool in an unsafe or unintended way," and ASI03 Identity and Privilege Abuse covers the identity it holds while doing so (https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/); LLM06 Excessive Agency is the model-level form (https://genai.owasp.org/llm-top-10/). For CI, the OpenSSF OSPS Baseline asks that a job assigned permissions get "only... the minimum privileges necessary" (OSPS-AC-04.02, https://baseline.openssf.org/). The per-run identity preference is the same move the publishing rule below makes for a registry token.

## Review a change to agent config as code, and keep a second party on every consequential action

The sandbox does not contain the config that matters most (confidence high, 3-0). As of 2026-10-03, Anthropic's sandboxing page says, verbatim, "The sandbox is off by default," and that "command hooks, local MCP servers, plugin monitors... run with your full access"; it covers shell commands only, and built-in file and web tools, the status line, LSP servers, and `apiKeyHelper` also sit outside it. The one caveat the verifiers recorded: sandboxed commands cannot write to Claude Code's config files, which closes one path for planting a new hook but does nothing about one already installed. Source: https://docs.claude.com/en/docs/claude-code/sandboxing.

Repo-shipped config has produced real advisories (confidence medium). Check Point showed that hooks in a repo's `.claude/settings.json` could run arbitrary shell commands (GHSA-ph6w-f82w-28w6, fixed in v1.0.87); the trust dialog did appear, but did not make clear that accepting it allowed execution, which is why this half was voted 2-1 rather than 3-0 ("without user approval" overstated it). In CVE-2026-21852 (fixed in 2.0.65, voted 3-0), a project-level `ANTHROPIC_BASE_URL` sent API traffic, including the plaintext API key, to an attacker's server before the trust prompt. The main source is secondary but matches the primary advisory: https://www.theregister.com/2026/02/26/clade_code_cves/. These two folder-trust defects are why a current harness matters, a sentence the rule no longer carries.

Codex is a useful contrast: in workspace-write mode it keeps `.git` (including gitdir pointers), `.agents`, and `.codex` read-only, so the agent cannot rewrite git hooks or its own config (confidence high, 3-0; https://developers.openai.com/codex/agent-approvals-security). The verifiers' caveats: `.agents` and `.codex` are protected only when they exist as directories, and 2026 sandbox escapes were implementation bugs patched in Codex CLI 0.149.0 and later, so this is a documented design, not a guarantee. It is also the shape of the rule's last sentence, running generated code inside a boundary that code cannot edit.

The rule's clause about refusing a change that "approves every server" does not rest on a verified incident: the related claim that `.mcp.json` could auto-approve every MCP server (CVE-2025-59536) was refuted 1-2 and is listed below. The clause stands as plain review practice for a setting with that effect. How a plugin that ships its own hooks should prove its integrity to adopters (signed releases, pinned versions or SHAs, a documented hook audit surface) is an open question the run did not settle.

The second-party sentences rest on standards, not on an incident verified in this cycle. Separation of privilege is Saltzer and Schroeder's (https://web.mit.edu/Saltzer/www/publications/protection/Basic.html). OWASP's ASI05 Unexpected Code Execution notes that agentic tools "often generate and execute code" that "can bypass traditional security controls" (https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/). For a merge, the OSPS Baseline asks for "at least one non-author human approval" before the primary branch moves (OSPS-QA-07.01, https://baseline.openssf.org/), which `github.md`'s branch-protection rule carries.

## Bound an agent's loops, spend, and reach from outside it, and keep a record it cannot rewrite

This rule rests on standards, not on an incident verified in this cycle. OWASP's ASI08 Cascading Failures describes "a single fault (hallucination, malicious input, corrupted tool, or poisoned memory)" that "propagates across autonomous agents," noting that because agents "plan, persist, and delegate autonomously, a single error can bypass stepwise human checks"; that is the hand-off sentence. ASI10 Rogue Agents covers an agent that deviates "from its intended function or authorized scope," with consequences including "workflow hijacking, and operational sabotage," which is why the record must sit where the agent cannot write (https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/). LLM10 Unbounded Consumption in the LLM Top 10 is the spend half (https://genai.owasp.org/llm-top-10/). The coverage map also counts this rule toward STRIDE's repudiation and denial of service, and toward CIS Controls safeguards 8.1 to 8.3 on audit logs (https://www.cisecurity.org/controls/cis-controls-navigator, cited by number only).

The caps the Anchor names are documented elsewhere in this handbook: the GitHub Action's `--max-turns`, workflow timeouts, and concurrency, all opt-in, with nothing capping cost at the Action level (https://code.claude.com/docs/en/github-actions.md#manage-costs, in `docs/handbook/github.md`), and the plugin eval runner's `--max-cost-usd` ceiling (https://code.claude.com/docs/en/plugin-evals, in `docs/handbook/evals.md`). Each is set in the workflow file or on the command line, outside the agent's reach.

## Install only what was reviewed, and let a new release age first

The cooldown half is mechanically checkable for Dependabot (confidence high, 3-0). zizmor added a `dependabot-cooldown` audit in v1.15.0; as of v1.18.0 it flags a cooldown under 7 days by default, and v1.20.0 accounts for GitHub's new 3-day default. The audit does not cover package-manager-level cooldowns such as pnpm's `minimumReleaseAge`, npm or uv settings, or Renovate, so a house check would have to cover those separately. Source: https://docs.zizmor.sh/release-notes/. This is why the rendered `.github/dependabot.yml` template carries `cooldown: default-days: 7` on every `updates` entry, the threshold zizmor's default flags below, and why the rule's Anchor names it. Which package-manager cooldown and install-script settings are stable enough to check across ecosystems is an open question from the run.

The "caught and pulled within days" premise comes from practitioner posts the run fetched and extracted but did not put to its verification vote, so treat them as reading, not as verified findings. One post (updated through June 2026) reports that malicious versions in recent incidents (Nx/s1ngularity, axios, TanStack, durabletask) were typically removed within hours, from minutes up to about 72 hours (https://christian-schneider.net/blog/dependency-cooldowns-supply-chain-defense). A survey of cooldown implementations reports that 8 of 10 examined attacks had exploitation windows under a week (https://nesbitt.io/2026/03/04/package-managers-need-to-cool-down.html), and a follow-up post on cooldowns argues that even a cooldown of days lets vendors and index maintainers remove a package first (https://www.blog.yossarian.net/2025/12/13/cooldowns-redux). The skeptical side is recorded too: one post argues a cooldown protects an adopter only because users who did not wait install the malicious version first and trigger the yank, shifting risk rather than removing it (https://calpaterson.com/deps.html). Security updates stay exempt because the rule's aim is to delay what nobody has vetted, not a fix.

The install-script and fork sentences are Clinejection's lessons (see the first rule's section): the injected agent ran `npm install` from an attacker's fork, and the payload arrived as that package's preinstall script. The registry-lookup sentence (a model can produce a plausible name nobody published) leans on general practice that the research run did not verify; no finding covers it. The frozen-lockfile sentence is general practice too. The binaries sentence rests on standards: the OSPS Baseline says the version control system "MUST NOT contain generated executable artifacts" and "MUST NOT contain unreviewable binary artifacts" (OSPS-QA-05.01, OSPS-QA-05.02, https://baseline.openssf.org/), and OpenSSF Scorecard's Binary-Artifacts check scores the same thing (https://github.com/ossf/scorecard/blob/main/docs/checks.md).

## Release with a short-lived identity, and attest what you ship

Long-lived publish tokens in CI secrets are what the two supply-chain incidents in this run ended in (confidence high). npm trusted publishing with OIDC went GA on 2025-07-31, initially for GitHub-hosted and gitlab.com shared runners only, and generates provenance attestations automatically for public source repos with no `--provenance` flag (3-0; https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/). AsyncAPI's Shai-Hulud postmortem traces its compromise to an unrotated, long-lived npm token stored only in GitHub secrets, with no team member holding a local copy, and names OIDC trusted publishing as the planned remedy (https://www.asyncapi.com/blog/shai-hulud-postmortem). That attribution was voted 2-1: the postmortem says the vector was "possibly" CI/CD or a leaked token and calls itself preliminary. In Clinejection, the stolen npm token was still valid when it was used to publish, which is the rule's "revoke a token the moment a disclosure names it," and the poisoned cache the release workflow restored is the rule's cache sentence.

The rule's "harden the publishing workflow anyway" sentence exists because the strong version of the claim was refuted 0-3: trusted-publishing credentials can be stolen, since OIDC does not stop code already running inside the trusted workflow. The run also extracted, without a verification vote, a May 2026 TanStack/router compromise in which a fork PR triggered `pull_request_target` workflows, the attacker poisoned the Actions cache across the fork and base trust boundary, then pulled OIDC tokens from runner memory and published 84 malicious versions of 42 packages (https://www.copilotkit.ai/blog/tanstack-supply-chain-attack-and-how-to-lock-down-github-actions). Limits from the run's caveats: provenance is unavailable for private source repos, and trusted publishing at GA did not support self-hosted runners.

The attest sentence rests on standards. NIST's SSDF practice PS.2 asks a producer to "make software integrity verification information available to software acquirers," with posted hashes and code signing as its examples (NIST SP 800-218 v1.1, https://csrc.nist.gov/pubs/sp/800/218/final). The OSPS Baseline asks that an official release "be signed or accounted for in a signed manifest including each asset's cryptographic hashes" (OSPS-BR-06.01, https://baseline.openssf.org/). SLSA's build track puts provenance at Build L1 and signed provenance from a hosted build at L2 (https://slsa.dev/spec/v1.2/), and Scorecard's Signed-Releases check scores it (https://github.com/ossf/scorecard/blob/main/docs/checks.md). npm's automatic provenance above is one way to meet it.

## Scan code and dependencies for known flaws, and give every finding an end

This rule rests on standards, not on an incident verified in this cycle. NIST's SSDF covers each sentence (NIST SP 800-218 v1.1, https://csrc.nist.gov/pubs/sp/800/218/final). PW.7.2 is to "perform the code review and/or code analysis... and record and triage all discovered issues and recommended remediations in the development team's workflow or issue tracking system." RV.1.1 asks a team to gather information "on potential vulnerabilities in the software and third-party components that the software uses," which is the scheduled scan, since a component's flaw can be published after the merge. RV.2.2 asks for a risk response per vulnerability, with risk acceptance as one possible answer, which is the rule's three ends. RV.3.3 is the last sentence: "review the software for similar vulnerabilities to eradicate a class of vulnerabilities." OpenSSF Scorecard's SAST and Vulnerabilities checks score the two scans (https://github.com/ossf/scorecard/blob/main/docs/checks.md), and the OSPS Baseline's level 3 asks that every change be evaluated for security weaknesses and known-vulnerable dependencies, with any suppression declared (OSPS-VM-05.03, OSPS-VM-06.02, https://baseline.openssf.org/). OWASP ASVS goes one step further than this rule: it asks for documented remediation time frames for vulnerable components and that none be breached (V15.1.1, V15.2.1, https://github.com/OWASP/ASVS). The rule gives every finding an end but sets no time frame, and the coverage map marks that gap.

The one incident-side note: a third-party article the research run fetched reports that a one-line Go fix made Dependabot open thousands of pull requests against repositories that never called the vulnerable method (https://www.theregister.com/2026/02/24/github_dependabot_noise_machine/, extracted, not put to the vote). That noise is why the rule asks for an end per finding, dismissal with a written reason included, rather than a fix for every alert.

## Supply untrusted input as a parameter, never by building a string

The four sinks the rule names are the four weaknesses Veracode tested (confidence medium, 3-0). In Veracode's testing, 45% of AI-generated samples failed security tests with OWASP Top 10 flaws, across 80 curated tasks in 4 languages and 4 CWEs: SQL injection, cross-site scripting, log injection, and weak crypto. Rates varied widely, from about 38% in Python to about 72% in Java, and reached 86% for XSS and 88% for log injection; a spring 2026 update reports the secure rate flat at about 55%. Source: https://www.veracode.com/resources/genai-code-security-report/. The caveat matters more than the headline: this is a SAST vendor grading with its own scanner, on tasks designed to offer a vulnerable path, with no security prompting, so it shows the concatenating path is taken often when it is open, which is the rule's claim, and is not a base rate for agent-written code in general. The claim that newer or larger models write no more secure code was refuted 0-3 and is not cited for anything.

The standards say the same per sink. OWASP ASVS 5.0.0 level 1 asks for context-relevant output encoding (V1.2.1), parameterized database queries (V1.2.4), parameterized OS calls or contextual encoding against command injection (V1.2.5), and avoiding `eval()` and other dynamic code execution (V1.3.2), which is the rule's "never evaluate it as code" (https://github.com/OWASP/ASVS). Its validation requirements are the boundary sentence: "positive validation against an allow list of values, patterns, and ranges" (V2.2.1), enforced "at a trusted service layer" and never relied on client-side (V2.2.2). The coverage map ties the rule to OWASP Top 10:2025 A05 Injection and CWE-79, 89, 78, 77, 94, and 20.

## Never let a request choose what the server fetches, opens, loads, or runs

This rule rests on standards, not on an incident verified in this cycle. OWASP ASVS 5.0.0 level 1 carries most of it (https://github.com/OWASP/ASVS). V5.3.2 asks that file paths use "internally generated or trusted data" rather than user-submitted filenames, "to protect against path traversal, local or remote file inclusion (LFI, RFI), and server-side request forgery (SSRF) attacks." V5.3.1 asks that uploaded files in a public folder not be executed as server-side code, V5.2.1 that a file be accepted only at a size the application can process, and V5.2.2 that its extension and contents be checked against the expected type. V1.5.1 asks for XML parsers with external entities disabled. The coverage map ties the rule to CWE-918 (server-side request forgery), CWE-22 (path traversal), CWE-434 (unrestricted upload), and CWE-502 (deserialization of untrusted data) in the CWE Top 25 (https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html), to OWASP Top 10:2025 A01 and A08, and to Proactive Control C10, Stop Server-Side Request Forgery (https://top10proactive.owasp.org/).

The explicit-field-binding sentence (mass assignment) has no level 1 ASVS requirement and no row of its own in the coverage map; it rests on general practice.

## Authenticate every non-public function, and authorize every object on the server

No verified claim from the research run covers authorization, so this rule rests on standards. OWASP ASVS 5.0.0 level 1 asks that function-level access be "restricted to consumers with explicit permissions" (V8.2.1), that data-specific access be restricted the same way "to mitigate insecure direct object reference (IDOR) and broken object level authorization (BOLA)" (V8.2.2), and that authorization be enforced "at a trusted service layer" rather than through "controls that an untrusted consumer could manipulate, such as client-side JavaScript" (V8.3.1) (https://github.com/OWASP/ASVS). The CWE Top 25 entries the coverage map assigns here are CWE-862 missing authorization, CWE-863 incorrect authorization, CWE-284, CWE-639 authorization bypass through a user-controlled key, and CWE-306 missing authentication for a critical function (https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html); Broken Access Control is A01 in the OWASP Top 10:2025 (https://owasp.org/Top10/). Deny by default is Saltzer and Schroeder's fail-safe defaults and complete mediation (https://web.mit.edu/Saltzer/www/publications/protection/Basic.html).

The check-and-act-in-one-step sentence (a time-of-check to time-of-use race) has no row of its own in the coverage map and rests on general practice. The Anchor's test follows the same unauthenticated-request shape as `github.md`'s preview-URL rule.

## Use vetted mechanisms for crypto, sessions, and transport

The nearest verified evidence is Veracode's: weak crypto was one of the four weaknesses its AI-generated samples failed on (https://www.veracode.com/resources/genai-code-security-report/, with the caveats under the parameter rule), which shows the failure happens without saying what fixes it. The prescriptions rest on standards. OWASP ASVS 5.0.0 level 1 (https://github.com/OWASP/ASVS):

- Crypto: no insecure block modes or weak padding (V11.3.1), only approved ciphers and modes such as AES-GCM (V11.3.2), and no disallowed hash such as MD5 for any cryptographic purpose (V11.4.1).
- Sessions: tokens verified by a trusted backend (V7.2.1), dynamically generated rather than static secrets (V7.2.2), from a CSPRNG with at least 128 bits of entropy when they are reference tokens (V7.2.3), and a new token issued at sign-in (V7.2.4); a terminated session cannot be reused (V7.4.1).
- Self-contained tokens: signature or MAC validated before the contents are trusted (V9.1.1), algorithms from an allowlist that excludes `None` (V9.1.2), and `nbf` and `exp` checked (V9.2.1).
- Attempts: controls against credential stuffing and brute force (V6.3.1).
- Transport: TLS for all connectivity to external-facing services with no fallback (V12.2.1), publicly trusted certificates (V12.2.2), and only current TLS versions (V12.1.1).

The second-factor sentence has no level 1 ASVS requirement behind it; the coverage map places multi-factor sign-in under CIS Controls safeguards 6.3 to 6.5 for accounts (cited by number only, https://www.cisecurity.org/controls/cis-controls-navigator), and the rule asks for it only where the platform offers one. The "not even in a helper meant only for tests" clause is general practice.

## Fail closed, and tell an outside caller little

This rule rests on standards, not on an incident verified in this cycle. OWASP's Top 10:2025 added A10 Mishandling of Exceptional Conditions as a new category, "focusing on improper error handling, logical errors, failing open, and other related scenarios stemming from abnormal conditions" (https://owasp.org/Top10/). Fail-safe defaults is Saltzer and Schroeder's (https://web.mit.edu/Saltzer/www/publications/protection/Basic.html). For what leaves the server, OWASP ASVS level 1 asks that sensitive data travel only in a message body or header, never in a URL or query string (V14.2.1), and that a response return only the required subset of an object's fields (V15.3.1) (https://github.com/OWASP/ASVS); CWE-200, exposure of sensitive information, is the coverage map's weakness row (https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html). The logging sentence maps to CIS Controls safeguards 8.1 to 8.3 on audit logs (cited by number only, https://www.cisecurity.org/controls/cis-controls-navigator); alerting on those logs is left out, per the map.

## Ship secure defaults, and bound what one caller can consume

This rule rests on standards, not on an incident verified in this cycle. NIST's SSDF practice PW.9 asks a producer to "define a secure baseline by determining how to configure each setting that has an effect on security... so that the default settings are secure and do not weaken the security functions provided by the platform" (NIST SP 800-218 v1.1, https://csrc.nist.gov/pubs/sp/800/218/final). Security Misconfiguration rose to A02 in the OWASP Top 10:2025, which says "misconfigurations are more prevalent in the data for this cycle" (https://owasp.org/Top10/). OWASP ASVS 5.0.0 level 1 supplies the specifics (https://github.com/OWASP/ASVS): no default accounts such as `root`, `admin`, or `sa` (V6.3.2, and CIS Controls safeguard 4.7 by number); cookies with the `Secure` attribute and a `__Host-` or `__Secure-` prefix (V3.3.1); a defence against cross-site request forgery (V3.5.1); content-security-policy sandboxing among the controls against rendering content in the wrong context (V3.2.1); no source-control metadata reachable in a deployment (V13.4.1); and a file size limit "without causing... a denial of service attack" (V5.2.1). CWE-352 (cross-site request forgery) and CWE-770 (allocation without limits) are the coverage map's weakness rows (https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html), and Proactive Controls C5 and C8 are secure-by-default configuration and browser security features (https://top10proactive.owasp.org/).

## Coverage map

Every class in the taxonomies below has a verdict, so an absence is a decision and not an oversight. Check a new incident against this map before writing a rule: if its class is already covered, add the incident to the covering rule's section as evidence and leave the rule alone.

Rule key (S1 to S7 are headings in `plugins/house/modules/security/rules/security.md` and S8 to S13 in `plugins/house/modules/security/rules/security-server.md`, unless a file is named):

- S1 Treat every input to the model as data, never as instructions
- S2 Give an agent, a key, and a token only what one task needs
- S3 Review a change to agent config as code, and keep a second party on every consequential action
- S4 Bound an agent's loops, spend, and reach from outside it, and keep a record it cannot rewrite
- S5 Install only what was reviewed, and let a new release age first
- S6 Release with a short-lived identity, and attest what you ship
- S7 Scan code and dependencies for known flaws, and give every finding an end
- S8 Supply untrusted input as a parameter, never by building a string
- S9 Never let a request choose what the server fetches, opens, loads, or runs
- S10 Authenticate every non-public function, and authorize every object on the server
- S11 Use vetted mechanisms for crypto, sessions, and transport
- S12 Fail closed, and tell an outside caller little
- S13 Ship secure defaults, and bound what one caller can consume
- G-perm: github.md "Give a workflow read-only permissions and pin every action by SHA"
- G-branch: github.md "Protect the default branch at the remote, and name an owner for what runs with privilege"
- G-cred: github.md "Keep credentials out of the repo, the commit, and the chat"
- G-push: github.md "Turn on push protection, head-branch deletion, and grouped dependency updates"
- G-log: github.md "Never log a vendor object"
- G-community: github.md "Ship the community files the platform looks for, and keep issue intake as forms"
- G-gate: github.md "Gate every PR on checks that need no credential, and name what is not gated"
- L: llm-output.md (the quarantine, citation, and approval rules)
- D-backup: deployment.md (the backup rule)

### OWASP Top 10:2025

Source: https://owasp.org/Top10/ (2025 edition; the introduction in the project repository carries no release-candidate label, read 2026-10-03).

| Class | Verdict | Rule |
|---|---|---|
| A01 Broken Access Control | Covered | S10, S9 |
| A02 Security Misconfiguration | Covered | S13; agent side S2, S3 |
| A03 Software Supply Chain Failures | Covered | S5, S6, G-perm |
| A04 Cryptographic Failures | Covered | S11, S12 |
| A05 Injection | Covered | S8 |
| A06 Insecure Design | Left out | Threat modelling is a design activity no session rule performs; S10 and S13 carry its deny-by-default core |
| A07 Authentication Failures | Covered | S11, S10 |
| A08 Software or Data Integrity Failures | Covered | S9, S5, S6 |
| A09 Security Logging and Alerting Failures | Partial | S12 covers logging; alerting is operations and left out |
| A10 Mishandling of Exceptional Conditions | Covered | S12 |

### OWASP ASVS 5.0.0, level 1

Source: https://github.com/OWASP/ASVS (release 5.0.0; 70 of 345 requirements are level 1). Mapped requirement by requirement against the level 1 text. The requirement column is a short paraphrase; the standard's own wording governs.

Of the 70: 28 covered, 15 partial, 22 not covered, 5 left out. The rules state principles and leave specifics to the standard, so a repo that needs level 1 conformance verifies against the standard itself; the rule file's opening says so. A requirement cited in a rule's section above is the standard the rule draws on; whether the rule covers it is this table's verdict, not the citation's.

| Requirement | What it asks | Verdict | Rule or gap |
|---|---|---|---|
| V1.2.1 | Output encoding fits the context | Covered | S8 |
| V1.2.2 | Untrusted data encoded when building an address; only safe protocols | Partial | S8 encodes for the context; a protocol allowlist is not named |
| V1.2.3 | Encoding when building script or structured-data content | Covered | S8 |
| V1.2.4 | Parameterized database queries | Covered | S8 |
| V1.2.5 | Protection against command injection | Covered | S8 |
| V1.3.1 | Rich text from an editor sanitized with a known library | Not covered | S8 encodes output; sanitizing permitted markup is not named |
| V1.3.2 | No dynamic code execution on input | Covered | S8 |
| V1.5.1 | Restrictive XML parser configuration | Partial | S9 bars deserializing with a mechanism that can run code; external-entity settings are not named |
| V2.1.1 | Validation rules documented | Not covered | Documentation requirement |
| V2.2.1 | Positive validation against what is allowed | Covered | S8 |
| V2.2.2 | Validation enforced at a trusted layer | Covered | S8, at the trust boundary |
| V2.3.1 | Multi-step flows processed in order | Not covered |  |
| V3.2.1 | Content not rendered in the wrong context | Partial | S13 names a content security policy and S9 keeps uploads outside the served root; the other controls are not named |
| V3.2.2 | Text rendered with safe functions | Covered | S8 |
| V3.3.1 | Cookie secure attribute and name prefix | Partial | S13 names cookie flags; the name prefix is not named |
| V3.4.1 | Strict transport header | Not covered |  |
| V3.4.2 | Cross-origin sharing limited to trusted origins | Not covered |  |
| V3.5.1 | Defence against cross-site request forgery | Covered | S13 |
| V3.5.2 | Preflight reliance cannot be bypassed | Partial | S13 asks for a request-forgery defence in general |
| V3.5.3 | Sensitive actions do not use safe methods | Not covered |  |
| V4.1.1 | Response content type matches the body | Not covered |  |
| V4.4.1 | Encrypted socket transport | Covered | S11 |
| V5.2.1 | Upload size limited | Covered | S9, S13 |
| V5.2.2 | Upload extension and content match | Covered | S9 |
| V5.3.1 | Uploaded files never run as server code | Covered | S9 |
| V5.3.2 | File paths built from trusted names | Covered | S9 |
| V6.1.1 | Rate limiting and anti-automation documented | Not covered | Documentation requirement |
| V6.2.1 to V6.2.8 | Password policy specifics: length, change flow, common-password check, no composition rules, masking, paste allowed, exact comparison | Not covered | S11 points to a vetted mechanism and states none of these |
| V6.3.1 | Controls against credential stuffing and brute force | Covered | S11, S13 |
| V6.3.2 | No default accounts | Covered | S13 |
| V6.4.1 | Initial passwords random, short-lived, single use | Partial | S11 requires a cryptographic random source and short-lived tokens; initial-password expiry is not named |
| V6.4.2 | No password hints or secret questions | Not covered |  |
| V7.2.1 | Session tokens verified by a trusted backend | Covered | S10, S11 |
| V7.2.2 | Dynamically generated tokens, not static keys | Partial | S11 asks for short-lived, revocable tokens; static keys are not named |
| V7.2.3 | Reference tokens unique, random, with enough entropy | Partial | S11 bars a non-cryptographic random source; an entropy floor is not stated |
| V7.2.4 | New session token at sign-in | Covered | S11 |
| V7.4.1 | A terminated session cannot be used | Covered | S11 |
| V7.4.2 | All sessions end when an account is disabled | Partial | S11 asks for revocable sessions; the trigger is not named |
| V8.1.1 | Authorization rules documented | Not covered | Documentation requirement |
| V8.2.1 | Function-level access restricted | Covered | S10 |
| V8.2.2 | Data-level access restricted per object | Covered | S10 |
| V8.3.1 | Authorization enforced at a trusted layer | Covered | S10 |
| V9.1.1 | Token signature verified | Covered | S11 |
| V9.1.2 | Token algorithm from an allowlist | Covered | S11 |
| V9.1.3 | Token key material from trusted sources | Not covered |  |
| V9.2.1 | Token validity window checked | Covered | S11 |
| V10.4.1 to V10.4.5 | Authorization-server requirements | Left out | Applies to a repo that runs an authorization server |
| V11.3.1 | No insecure block modes or weak padding | Partial | S11 relies on a vetted library's defaults; modes are not named |
| V11.3.2 | Approved ciphers and modes only | Partial | Same |
| V11.4.1 | Approved hash functions only | Partial | S11 names a fast hash for a password only |
| V12.1.1 | Current transport protocol versions only | Partial | S11 asks for verified transport; versions are not named |
| V12.2.1 | Encrypted transport for all external connections, no fallback | Covered | S11 |
| V12.2.2 | Publicly trusted certificates | Partial | S11 bars disabling certificate checks; certificate issuance is not named |
| V13.4.1 | No source-control metadata deployed | Partial | S13 asks that nothing be exposed the feature does not need; the metadata folder is not named |
| V14.2.1 | No sensitive data in the address or query string | Covered | S12 |
| V14.3.1 | Authenticated data cleared from client storage | Not covered |  |
| V15.1.1 | Remediation time frames documented | Not covered | S7 gives every finding an end and sets no time frame |
| V15.2.1 | No component past its remediation time frame | Not covered | Same |
| V15.3.1 | Only the required fields returned | Covered | S12 |

V16 Security Logging and Error Handling and V17 WebRTC have no level 1 requirement; S12 carries the logging and error-handling principle.

### OWASP Top 10 Proactive Controls 2024

Source: https://top10proactive.owasp.org/

| Control | Verdict | Rule |
|---|---|---|
| C1 Implement Access Control | Covered | S10 |
| C2 Use Cryptography to Protect Data | Covered | S11 |
| C3 Validate All Input and Handle Exceptions | Covered | S8, S12 |
| C4 Address Security from the Start | Left out | Design process |
| C5 Secure by Default Configurations | Covered | S13 |
| C6 Keep Your Components Secure | Covered | S5, S7 |
| C7 Secure Digital Identities | Covered | S11 |
| C8 Leverage Browser Security Features | Covered | S13 |
| C9 Implement Security Logging and Monitoring | Partial | S12 covers logging; monitoring is operations |
| C10 Stop Server-Side Request Forgery | Covered | S9 |

### CWE Top 25 (2025)

Source: https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html

| Weakness | Verdict | Rule |
|---|---|---|
| CWE-79 Cross-site scripting | Covered | S8 |
| CWE-89 SQL injection | Covered | S8 |
| CWE-352 Cross-site request forgery | Covered | S13 |
| CWE-862 Missing authorization | Covered | S10 |
| CWE-863 Incorrect authorization | Covered | S10 |
| CWE-284 Improper access control | Covered | S10 |
| CWE-639 Authorization bypass through a user-controlled key | Covered | S10 |
| CWE-306 Missing authentication for a critical function | Covered | S10 |
| CWE-22 Path traversal | Covered | S9 |
| CWE-434 Unrestricted upload | Covered | S9 |
| CWE-502 Deserialization of untrusted data | Covered | S9 |
| CWE-918 Server-side request forgery | Covered | S9 |
| CWE-78, CWE-77 Command injection | Covered | S8 |
| CWE-94 Code injection | Covered | S8, S9 |
| CWE-20 Improper input validation | Covered | S8 |
| CWE-200 Exposure of sensitive information | Covered | S12, G-log |
| CWE-770 Allocation without limits | Covered | S13 |
| Memory-safety group (CWE-787, 416, 125, 120, 476, 121, 122) | Left out | Depends on the adopter's language; a repo with native code needs its own rule |

### STRIDE

| Threat | Verdict | Rule |
|---|---|---|
| Spoofing | Covered | S11, S10 |
| Tampering | Covered | S5, S6, S9, S11 |
| Repudiation | Covered | S12, S4 |
| Information disclosure | Covered | S12, G-cred, G-log |
| Denial of service | Covered | S13, S4 |
| Elevation of privilege | Covered | S10, S2 |

### OWASP Top 10 for LLM Applications 2025

Source: https://genai.owasp.org/llm-top-10/

| Risk | Verdict | Rule |
|---|---|---|
| LLM01 Prompt Injection | Covered | S1 |
| LLM02 Sensitive Information Disclosure | Covered | S2, S12, G-cred |
| LLM03 Supply Chain | Covered | S5, S3 |
| LLM04 Data and Model Poisoning | Left out | Model training |
| LLM05 Improper Output Handling | Covered | S8, L |
| LLM06 Excessive Agency | Covered | S2, S3 |
| LLM07 System Prompt Leakage | Left out | A concern of an application that ships a prompt, not of a session rule |
| LLM08 Vector and Embedding Weaknesses | Left out | Application retrieval design |
| LLM09 Misinformation | Covered | L |
| LLM10 Unbounded Consumption | Covered | S4 |

### OWASP Top 10 for Agentic Applications 2026

Source: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ (item titles read from the official PDF).

| Risk | Verdict | Rule |
|---|---|---|
| ASI01 Agent Goal Hijack | Covered | S1 |
| ASI02 Tool Misuse and Exploitation | Covered | S2 |
| ASI03 Identity and Privilege Abuse | Covered | S2, S6 |
| ASI04 Agentic Supply Chain Vulnerabilities | Covered | S3, S5 |
| ASI05 Unexpected Code Execution | Covered | S3 |
| ASI06 Memory and Context Poisoning | Covered | S1 |
| ASI07 Insecure Inter-Agent Communication | Partial | S1 and S4 treat a message as untrusted and verify a handed-off result; authenticating, signing, and replay-protecting the channel is not covered |
| ASI08 Cascading Failures | Covered | S4 |
| ASI09 Human-Agent Trust Exploitation | Covered | L |
| ASI10 Rogue Agents | Partial | S4 and S3 bound the agent and keep a record and a second party; monitoring and detection are operations and left out |

### Saltzer and Schroeder's design principles

Source: https://web.mit.edu/Saltzer/www/publications/protection/Basic.html

| Principle | Verdict | Rule |
|---|---|---|
| Least privilege | Covered | S2 |
| Fail-safe defaults | Covered | S10, S12, S13 |
| Complete mediation | Covered | S10 |
| Separation of privilege | Covered | S3 |
| Economy of mechanism | Partial | S11 prefers the vetted mechanism over a hand-rolled one; otherwise judgment |
| Open design | Partial | claude-code.md asks a settings file to say it is not a boundary; no general rule |
| Least common mechanism | Partial | S6 keeps the release cache apart; no general rule |
| Psychological acceptability | Left out | A design aim of this package (low-friction controls), not a rule a session follows |

### NIST SSDF, SP 800-218 v1.1

Source: https://csrc.nist.gov/pubs/sp/800/218/final (practice names read from the document). The Rev. 1 draft of December 2025 was not read. SP 800-218A, the generative-AI profile, addresses teams that train models and is not mapped.

| Practice | Verdict | Rule |
|---|---|---|
| PO.1 to PO.5 Prepare the organization | Left out | An organizational program; S2 touches PO.5's environment separation |
| PS.1 Protect all forms of code | Covered | G-branch, G-cred |
| PS.2 Verify release integrity | Covered | S6 |
| PS.3 Archive and protect each release | Partial | S6 attests; immutable archives are a repository setting |
| PW.1, PW.2 Design to meet security requirements and review the design | Left out | Design process |
| PW.4 Reuse existing well-secured software | Covered | S5, S11 |
| PW.5 Create source code by secure coding practices | Covered | S8 to S13 |
| PW.6 Configure build processes | Covered | G-perm, S5 |
| PW.7 Review and analyze code | Covered | S7 for analysis; G-branch adds a non-author review once there is a second maintainer |
| PW.8 Test executable code | Covered | S7 and each rule's test anchor |
| PW.9 Secure by default | Covered | S13 |
| RV.1 Identify and confirm vulnerabilities | Covered | S7, G-community |
| RV.2 Assess, prioritize, and remediate | Covered | S7 |
| RV.3 Analyze root causes | Partial | S7 looks for the same flaw elsewhere; root-cause analysis and feeding it back into the process are not covered |

### OpenSSF Scorecard checks

Source: https://github.com/ossf/scorecard/blob/main/docs/checks.md

| Check | Verdict | Rule |
|---|---|---|
| Token-Permissions | Covered | G-perm |
| Pinned-Dependencies | Covered | G-perm, S5 |
| Dangerous-Workflow | Covered | G-perm |
| Branch-Protection | Covered | G-branch |
| Code-Review | Partial | G-branch requires a non-author review only once there is a second maintainer |
| CI-Tests | Covered | G-gate |
| Security-Policy | Covered | G-community |
| Dependency-Update-Tool | Covered | G-push |
| SAST, Vulnerabilities | Covered | S7 |
| Binary-Artifacts | Covered | S5 |
| Signed-Releases | Covered | S6 |
| Fuzzing, SBOM, CII-Best-Practices, Contributors, Maintained, Packaging, Webhooks, License | Left out | Open-source governance or enterprise scope |

### OpenSSF OSPS Baseline, levels 1 and 2

Source: https://baseline.openssf.org/ (version 2026-08-28, read from a summarized checklist, so control-level wording is not verified).

| Family | Verdict | Rule |
|---|---|---|
| Access control (multi-factor sign-in, least role, protected branch) | Covered | G-branch, G-perm |
| Build and release (untrusted input in pipelines, release integrity) | Covered | G-perm, S6 |
| Quality (dependencies, binaries, required checks) | Covered | S5, G-gate, G-branch |
| Vulnerability management (private reporting, response) | Covered | G-community, S7 |
| Documentation | Covered | G-community |
| Governance, legal, security-assessment documents | Left out | Open-source governance scope |

### SLSA v1.2 build track

Source: https://slsa.dev/spec/v1.2/

| Level | Verdict | Rule |
|---|---|---|
| Build L1 provenance exists | Covered | S6 |
| Build L2 hosted build, signed provenance | Covered | S6 |
| Build L3 hardened build platform | Left out | Beyond this organization size |

### CIS Controls v8.1, Implementation Group 1

Source: https://www.cisecurity.org/controls/cis-controls-navigator (56 of 153 safeguards are in group 1). Cited by number only; the text is CIS's.

| Safeguards | Verdict | Rule |
|---|---|---|
| 4.7 default accounts | Covered | S13 |
| 5.1 to 5.4, 6.1 to 6.5 accounts, access, multi-factor sign-in | Partial | G-branch for repository access; company accounts are left out |
| 7.1 to 7.4 vulnerability and patch management | Partial | S7 and G-push for code and dependencies; operating-system patching is left out |
| 8.1 to 8.3 audit logs | Partial | S12 and S4 for what is logged and who can rewrite it; log storage capacity is left out |
| 11.1 to 11.4 data recovery | Partial | D-backup covers a tested, protected backup; automated scheduling and an isolated recovery copy are not covered |
| 3.1 to 3.6 data management | Partial | S12 for what the code collects and exposes; retention and inventory are left out |
| 17.1 to 17.3 incident reporting | Partial | G-community names the reporting route; an incident process is left out |
| 1, 2, 4.1 to 4.6, 9, 10, 12, 14, 15, 18.5 | Left out | Company IT hygiene: asset inventory, device configuration, mail and browser, malware defences, network, training, vendors |
| Control 16 application software security | Covered | Not in group 1, but S7 to S13 carry its substance |

### NIST AI 600-1

Source: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf (twelve risk categories).

| Risk | Verdict | Rule |
|---|---|---|
| Information Security | Covered | S1 to S4 |
| Data Privacy | Covered | S12, S2 |
| Value Chain and Component Integration | Covered | S5, S3 |
| Confabulation | Covered | L |
| Human-AI Configuration | Covered | L, S3 |
| The remaining seven (weapons information, dangerous content, environmental impact, bias, information integrity, intellectual property, abusive content) | Left out | Content and societal harms, not development controls |

### Deliberately left out, in one place

- Threat modelling and secure design review as a program.
- Memory safety, which depends on the adopter's language.
- Alerting, monitoring, and an incident-response process.
- Security training and company IT hygiene.
- SBOMs, fuzzing, and SLSA build level 3.
- Model training, retrieval stores, and system-prompt secrecy.
- Running an authorization server.
- Privacy-law compliance.

A repo that needs one of these writes its own rule; the map records that this package chose not to.

## Refuted claims

Three claims failed the run's adversarial vote. They are recorded so nobody re-adds them from the same sources.

- "Trusted publishing uses short-lived credentials scoped to a specific workflow, which the announcement says cannot be reused or stolen. This removes the stolen-publish-token attack path." Refuted 0-3: OIDC does not stop code already running inside the trusted workflow. Source checked: https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/
- "Newer or larger LLMs did not write more secure code, even though their functional correctness improved." Refuted 0-3. Source checked: https://www.veracode.com/resources/genai-code-security-report/
- "CVE-2025-59536: settings in a repo's .mcp.json could auto-approve every MCP server, so code ran before the user could read the trust dialog. It was fixed in September 2025 and published October 3, 2025." Refuted 1-2. Source checked: https://www.theregister.com/2026/02/26/clade_code_cves/

## Evidence held for github.md

Verified in the same run and outside this module's rules, kept here until `github.md`'s chapter takes it. AsyncAPI found a workflow that used untrusted context unsafely; its PR #1909 moved `${{ }}` values into environment variables and deleted a `pull_request_target` workflow that could run fork code, though AsyncAPI says this was not the root cause (3-0; https://www.asyncapi.com/blog/shai-hulud-postmortem). Since 2025-08-15, GitHub's allowed-actions policy has an opt-in setting at enterprise, org, or repo level that fails any workflow using an action not pinned by SHA, and supports `!` blocklist entries, evaluated last, for blocking a known-compromised action (3-0; https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/; plan-tier availability of the blocklist is unconfirmed). As of zizmor v1.20.0, the `unpinned-uses` audit requires hash pins by default even for `actions/*`, `github/*`, and `dependabot/*` (3-0; https://docs.zizmor.sh/release-notes/).

## Sources

Incident research, 2026-10-03:

- https://docs.claude.com/en/docs/claude-code/sandboxing (now https://code.claude.com/docs/en/sandboxing), primary: the sandbox's scope, the credential deny list, where credential entries are honored, and the egress proxy.
- https://www.theregister.com/2026/02/26/clade_code_cves/, secondary, with GHSA-ph6w-f82w-28w6: repo-shipped hooks and `ANTHROPIC_BASE_URL`.
- https://developers.openai.com/codex/agent-approvals-security, primary: Codex's read-only config directories and untrusted web results.
- https://labs.cloudsecurityalliance.org/research/csa-research-note-clinejection-prompt-injection-cicd-cache-p/, secondary, with https://adnanthekhan.com/posts/clinejection/ and GHSA-9ppg-jx86-fqw7: Clinejection.
- https://www.asyncapi.com/blog/shai-hulud-postmortem, primary: the long-lived token, the OIDC plan, and PR #1909.
- https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/, primary: trusted publishing and automatic provenance.
- https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/, primary: the SHA-pin and blocklist policy.
- https://docs.zizmor.sh/release-notes/, primary: the `dependabot-cooldown` and `unpinned-uses` audits.
- https://www.veracode.com/resources/genai-code-security-report/, primary vendor research: failure rates on four weaknesses.
- Fetched and extracted but not put to the verification vote: https://christian-schneider.net/blog/dependency-cooldowns-supply-chain-defense, https://nesbitt.io/2026/03/04/package-managers-need-to-cool-down.html, https://www.blog.yossarian.net/2025/12/13/cooldowns-redux, https://calpaterson.com/deps.html, https://www.copilotkit.ai/blog/tanstack-supply-chain-attack-and-how-to-lock-down-github-actions, https://www.theregister.com/2026/02/24/github_dependabot_noise_machine/.

Standards, read 2026-10-03 (each also listed under its coverage-map table):

- https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/, OWASP Top 10 for Agentic Applications 2026.
- https://genai.owasp.org/llm-top-10/, OWASP Top 10 for LLM Applications 2025.
- https://owasp.org/Top10/, OWASP Top 10:2025.
- https://github.com/OWASP/ASVS, OWASP ASVS 5.0.0, level 1 requirement text.
- https://top10proactive.owasp.org/, OWASP Top 10 Proactive Controls 2024.
- https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html, CWE Top 25 (2025).
- https://csrc.nist.gov/pubs/sp/800/218/final, NIST SP 800-218 v1.1 (SSDF).
- https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf, NIST AI 600-1.
- https://baseline.openssf.org/, OpenSSF OSPS Baseline (read from a summarized checklist).
- https://github.com/ossf/scorecard/blob/main/docs/checks.md, OpenSSF Scorecard checks.
- https://slsa.dev/spec/v1.2/, SLSA v1.2.
- https://www.cisecurity.org/controls/cis-controls-navigator, CIS Controls v8.1, cited by safeguard number only.
- https://web.mit.edu/Saltzer/www/publications/protection/Basic.html, Saltzer and Schroeder's design principles.
