#!/usr/bin/env node
/**
 * Secret scanner for the repository (PASSO 21). Looks at every file Git would commit
 * (tracked + untracked, honoring .gitignore) for credentials that must never be versioned:
 * private keys, provider API keys, OAuth tokens, signed webhook URLs and filled-in .env files.
 *
 * Test fixtures use obviously fake values; a match is ignored when the value itself says so
 * (fake, test, example, dummy, secret, change-me…). Exit code 1 when anything is found.
 *
 *   pnpm security:scan
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const RULES = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['OpenAI/Anthropic key', /\bsk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Google OAuth token', /\bya29\.[0-9A-Za-z_-]{20,}/],
  ['Google OAuth client secret', /\bGOCSPX-[0-9A-Za-z_-]{20,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  [
    'signed webhook URL',
    /https:\/\/[^\s'"]*(?:powerplatform|logic\.azure)[^\s'"]*[?&]sig=[A-Za-z0-9%_-]{20,}/,
  ],
  ['URL with password', /\b[a-z][a-z0-9+.-]*:\/\/[^:/\s@'"]+:([^@\s'"]{8,})@[^\s'"]+/],
];

/** Values that announce themselves as placeholders or test data. */
const PLACEHOLDER =
  /fake|test|example|dummy|sample|placeholder|change-?me|secret|local-?development|redacted|\bpass(?:word)?\b|xxxx|your[-_]|<[^>]+>|\$\{/i;

/**
 * Tests deliberately feed key-shaped strings ("sk-…") to prove they are encrypted, masked
 * and never echoed. There, only rules for formats that cannot be invented casually apply.
 */
const TEST_FILE = /(?:^|\/)test\/|\.(?:spec|test|int-spec)\.[cm]?[jt]sx?$/;
const TEST_SKIPPED_RULES = new Set(['OpenAI/Anthropic key']);

/** Variables in .env-like files that must stay empty in anything committed. */
const ENV_SECRETS =
  /^(?!\w*_VERSION\s*=)(?:\w*(?:API_KEY|SECRET|TOKEN|PASSWORD|ENCRYPTION_KEY\w*|PRIVATE_KEY))\s*=\s*(.+)$/;

const SKIP =
  /(?:^|\/)(?:pnpm-lock\.yaml|node_modules\/|dist\/|src\/generated\/)|\.(?:png|jpe?g|gif|webp|ico|pdf|xlsx|woff2?|ttf|mp3|wav|webm|ogg|zip)$/i;

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter((file) => file && !SKIP.test(file));

const findings = [];
for (const file of files) {
  let text;
  try {
    if (statSync(file).size > 2 * 1024 * 1024) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  const envFile = /(?:^|\/)\.env(?:\.[\w-]+)?$/.test(file);
  const testFile = TEST_FILE.test(file);
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [name, pattern] of RULES) {
      if (testFile && TEST_SKIPPED_RULES.has(name)) continue;
      const match = line.match(pattern);
      if (match && !PLACEHOLDER.test(match[1] ?? match[0])) {
        findings.push({ file, line: index + 1, name });
      }
    }
    if (envFile) {
      const env = line.trim().match(ENV_SECRETS);
      if (env && env[1].trim() !== '' && !PLACEHOLDER.test(env[1])) {
        findings.push({ file, line: index + 1, name: '.env value filled in' });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`Possible secrets found (${findings.length}):`);
  // Never print the value itself: only where it is and what it looks like.
  for (const item of findings) console.error(`  ${item.file}:${item.line}  ${item.name}`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} files.`);
