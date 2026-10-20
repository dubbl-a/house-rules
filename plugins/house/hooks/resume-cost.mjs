#!/usr/bin/env node
// SessionStart hook (resume|fork): warn when resuming costs a cache rewrite.
//
// Claude Code resends the whole conversation every request. After an idle
// gap longer than the prompt-cache lifetime, the first message rewrites the
// whole context into the cache at the write price, so resuming a large
// session can cost real money before any work happens. On Claude Code
// v2.1.251+ the resume input carries prompt_cache_likely_expired,
// context_tokens, seconds_since_last_response and estimated_cache_write_usd;
// older versions and empty transcripts omit them, and then there is nothing
// to say.
//
// The warning is advice, never a gate. Defaults a user can override from
// settings env or the shell: HOUSE_RESUME_COST_WARN=off disables the hook,
// HOUSE_RESUME_COST_WARN_USD sets the dollar threshold (default 0.25).
//
// A warning hook must never cost a session anything: bad JSON, missing or
// mistyped fields, or any error emits nothing and exits 0. Stdout is the
// only channel the harness reads, and only a JSON object is hook output;
// systemMessage is shown to the user.
import { readFileSync } from 'node:fs';

const DEFAULT_THRESHOLD_USD = 0.25;

function idle(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round((seconds / 3600) * 10) / 10} h`;
}

try {
  if (String(process.env.HOUSE_RESUME_COST_WARN || '').toLowerCase() !== 'off') {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const { prompt_cache_likely_expired: expired, estimated_cache_write_usd: usd, context_tokens: tokens, seconds_since_last_response: secs } = input;
    const override = Number.parseFloat(process.env.HOUSE_RESUME_COST_WARN_USD);
    const threshold = Number.isFinite(override) && override >= 0 ? override : DEFAULT_THRESHOLD_USD;
    if (expired === true && Number.isFinite(usd) && Number.isFinite(tokens) && Number.isFinite(secs) && usd >= threshold) {
      const systemMessage = `house: this session has been idle ${idle(secs)}, so its prompt cache has likely expired. ` +
        `Your first message will rewrite about ${tokens.toLocaleString('en-US')} tokens of context into the cache, an estimated $${usd.toFixed(2)} at list price. ` +
        'If you do not need this history, /clear and start fresh from a handoff note in the repo; a /compact now would pay the same rewrite first. ' +
        'To silence this, set HOUSE_RESUME_COST_WARN=off, or raise HOUSE_RESUME_COST_WARN_USD (default 0.25), in your shell or the env block of your settings.';
      process.stdout.write(JSON.stringify({ systemMessage }) + '\n');
    }
  }
} catch {
  // Never block or noise a session over a malformed payload.
}
process.exit(0);
