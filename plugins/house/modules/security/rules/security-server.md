<!-- house source rule file; vendored into consuming repos by /house-rules:sync -->
# Security: server code

What the code a session writes must never do once it handles a request, a query, a credential, or a secret.
Each rule states a principle meant to outlive the incident behind it; the standards each one answers, and the classes deliberately left out, are in the handbook chapter's coverage map.
Take the specifics a principle cannot carry, such as password policy, header values, and cipher choices, from the current first level of a maintained verification standard; the map lists which requirements these rules leave to it.
What a session may trust, install, and release is security.md's, which loads on agent config and the supply-chain files. Neither file restates the other.

## Supply untrusted input as a parameter, never by building a string

Bind values into a query, encode output for its context, pass process arguments as a list, log a value as a field, and validate at the trust boundary against what is allowed and never evaluate it as code; write the hostile case as a test in the change that adds the sink, since generated code takes the concatenating path often when both are open.
Anchor: a test per sink that feeds a quote, a tag, a newline, and a shell metacharacter and asserts each arrives inert.
Receipts: `docs/handbook/security.md#supply-untrusted-input-as-a-parameter-never-by-building-a-string`

## Never let a request choose what the server fetches, opens, loads, or runs

Resolve a requested address, file path, upload, or serialized object against an allowlist after normalizing it, store an upload outside the served root under a name the server chose and check its type and size, never deserialize untrusted data with a mechanism that can run code, and bind request fields to an explicit list.
Anchor: a test per entry point that sends an internal address, a parent-directory path, an oversized or mistyped file, and an extra field, and asserts each is refused.
Receipts: `docs/handbook/security.md#never-let-a-request-choose-what-the-server-fetches-opens-loads-or-runs`

## Authenticate every non-public function, and authorize every object on the server

Decide access on the server for every route and every object id a request names, deny by default, and make the check and the act one step; a client-side check, or one that confirms a login but not ownership, is no check.
Anchor: a test that requests each protected route unauthenticated and as the wrong user and asserts both fail; github.md's preview-URL rule sends the same request to a deployed host.
Receipts: `docs/handbook/security.md#authenticate-every-non-public-function-and-authorize-every-object-on-the-server`

## Use vetted mechanisms for crypto, sessions, and transport

Use the platform or a vetted library with its defaults for password hashing, tokens, and encryption, never a hand-rolled scheme, a fast general-purpose hash for a password, or a non-cryptographic random source for a secret; keep a session short-lived and revocable, replace it at sign-in, and verify its signature, algorithm, and expiry on every use.
Limit attempts on a credential, offer a second factor where the platform has one, send every connection over verified transport encryption, and never disable certificate checks, not even in a helper meant only for tests.
Anchor: a test that presents an expired, a tampered, and a wrong-algorithm token and asserts each is refused; security.md's scan rule flags a disabled certificate check.
Receipts: `docs/handbook/security.md#use-vetted-mechanisms-for-crypto-sessions-and-transport`

## Fail closed, and tell an outside caller little

Deny when a security decision errors, return a generic message to an untrusted caller, and log the detail on the server; engineering.md's teach-the-fix rule is for an operator reading a tool's output, not for a response crossing the trust boundary.
Log sign-ins, denials, and validation failures with who and when, log ids, amounts, and outcomes and never a whole customer, charge, or row object, keep secrets and personal data out of logs, addresses, caches, and responses, and collect and return only what the feature needs.
Anchor: a test that forces each error path and asserts a denial and a response body with no stack trace, file path, or query text.
Receipts: `docs/handbook/security.md#fail-closed-and-tell-an-outside-caller-little`

## Ship secure defaults, and bound what one caller can consume

Ship with debug off, no default credential, nothing exposed that the feature does not need, and the framework's browser protections on (a content security policy, cookie flags, a cross-site request forgery defence), and limit request size, rate, and time per caller and any loop or allocation that input controls.
Anchor: a test that reads the production config and asserts each default, and one that exceeds each limit and asserts the refusal.
Receipts: `docs/handbook/security.md#ship-secure-defaults-and-bound-what-one-caller-can-consume`

## Don't

- Don't concatenate input into a query, markup, a command, or a log line, or let a request name what the server fetches, opens, or runs.
- Don't return an error's detail to an untrusted caller, or ship a default that is unsafe until someone edits it.

Anchor: each prohibition is the negative of a rule above and inherits that rule's enforcement.
