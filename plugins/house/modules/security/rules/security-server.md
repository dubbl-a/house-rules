<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Security: server code

What the code a session writes must never do once it handles a request, a query, a credential, or a secret.
Each rule states a principle meant to outlive the incident behind it; the standards each one answers, and the classes deliberately left out, are in the handbook chapter's coverage map.
Take the specifics a principle cannot carry, such as password policy, header values, and cipher choices, from the current first level of a maintained verification standard; the map lists which requirements these rules leave to it.
What a session may trust, install, and release is security.md's, which loads on agent config and the supply-chain files. Neither file restates the other.

## Supply untrusted input as a parameter, never by building a string

Bind values into a query, encode on output for the context it lands in, pass arguments to a process as a list, and log a value as a field, because query, markup, shell, and log injection are one mistake: data concatenated into text a parser will read.
Validate input where it crosses the trust boundary, against what is allowed, not against a list of what is bad, and never evaluate it as code.
Write the hostile case as a test in the change that adds the sink, since generated code takes the concatenating path often when both are open.
Anchor: a test per sink that feeds a quote, a tag, a newline, and a shell metacharacter and asserts each arrives inert.
Receipts: `docs/handbook/security.md#supply-untrusted-input-as-a-parameter-never-by-building-a-string`

## Never let a request choose what the server fetches, opens, loads, or runs

Resolve a requested address, file path, upload, or serialized object against an allowlist after normalizing it, because a caller who names the target reaches internal hosts, files outside the root, and code the server will execute.
Store an upload outside the served root under a name the server chose, check its type and size, and never deserialize untrusted data with a mechanism that can run code.
Bind request fields to an explicit list, so a caller cannot set a field the form never showed.
Anchor: a test per entry point that sends an internal address, a parent-directory path, an oversized or mistyped file, and an extra field, and asserts each is refused.
Receipts: `docs/handbook/security.md#never-let-a-request-choose-what-the-server-fetches-opens-loads-or-runs`

## Authenticate every non-public function, and authorize every object on the server

Decide access on the server for every route and every object id a request names; a check in the client, or one that confirms a login but not ownership, is no check.
Deny by default, so a new route is closed until someone opens it.
Make the check and the act one step, so a concurrent request cannot slip between them.
Anchor: a test that requests each protected route unauthenticated and as the wrong user and asserts both fail; github.md's preview-URL rule sends the same request to a deployed host.
Receipts: `docs/handbook/security.md#authenticate-every-non-public-function-and-authorize-every-object-on-the-server`

## Use vetted mechanisms for crypto, sessions, and transport

Use the platform or a vetted library with its defaults for hashing a password, generating a token, and encrypting, never a hand-rolled scheme, a fast general-purpose hash for a password, or a non-cryptographic random source for a secret.
Keep a session or token short-lived and revocable, replace it at sign-in so the earlier one stops working, and verify its signature, algorithm, and expiry on every use.
Limit attempts on a credential, and offer a second factor where the platform has one.
Send every connection over verified transport encryption, and never disable certificate checks, not even in a helper meant only for tests.
Anchor: a test that presents an expired, a tampered, and a wrong-algorithm token and asserts each is refused; security.md's scan rule flags a disabled certificate check.
Receipts: `docs/handbook/security.md#use-vetted-mechanisms-for-crypto-sessions-and-transport`

## Fail closed, and tell an outside caller little

Deny when a security decision errors, return a generic message to an untrusted caller, and log the detail on the server; engineering.md's teach-the-fix rule is for an operator reading a tool's output, not for a response crossing the trust boundary.
Log sign-ins, denials, and validation failures with who and when, so an incident can be reconstructed.
Keep secrets and personal data out of logs, addresses, caches, and responses, and collect and return only what the feature needs; github.md's vendor-object rule is the logging half.
Anchor: a test that forces each error path and asserts a denial and a response body with no stack trace, file path, or query text.
Receipts: `docs/handbook/security.md#fail-closed-and-tell-an-outside-caller-little`

## Ship secure defaults, and bound what one caller can consume

Ship with debug off, no default credential, and nothing exposed that the feature does not need, so the unsafe setting is the one that takes an edit.
Set the browser protections the framework offers: a content security policy, cookie flags, and a defence against cross-site request forgery.
Limit request size, rate, and time for each caller, and bound any loop or allocation that input controls.
Anchor: a test that reads the production config and asserts each default, and one that exceeds each limit and asserts the refusal.
Receipts: `docs/handbook/security.md#ship-secure-defaults-and-bound-what-one-caller-can-consume`

## Don't

- Don't concatenate input into a query, markup, a command, or a log line, or let a request name what the server fetches, opens, or runs.
- Don't return an error's detail to an untrusted caller, or ship a default that is unsafe until someone edits it.

Anchor: each prohibition is the negative of a rule above and inherits that rule's enforcement.
