# Security policy

This repository is a development MVP. Production/staging startup remains disabled.
Only the current `main` development line receives fixes; no production release or
security support SLA is promised. A passing test suite is not a security guarantee.

## Reporting a vulnerability

Use **Security > Advisories > Report a vulnerability** at
<https://github.com/KeepISC/loja-1/security/advisories> if private reporting has been
enabled by a maintainer. Its availability has not been verified. If unavailable,
open an issue requesting a private reporting channel without exploit details or
sensitive attachments; wait for a maintainer-provided private channel.

Include affected revision, impact, minimal fictional reproduction, expected and
actual behavior, and suggested mitigation. Never include real passwords, tokens,
private supplier contacts, database dumps, payment data, raw webhooks or email
previews. Do not test against live infrastructure or other users' accounts.

If credentials were exposed, privately notify their owner and revoke/rotate them;
removing a file or adding an ignore rule does not revoke a credential or erase Git
history. Agree on remediation and disclosure timing privately before publishing
technical details. No paid bounty or response deadline is implied.

## Maintainer checks

Review authentication/ownership, CSRF, payment/webhook verification, email bearer
links and database/migration safety using `AGENTS.md` and the PR checklist.
Use isolated fictional data and mock providers. Review `npm audit` output and
Dependabot alerts; never run `npm audit fix --force` or merge dependency updates
automatically. See [the security review](DEPENDENCY_SECURITY_REVIEW.md) for known
dependency concerns and [governance](docs/github-governance.md) for CI gates,
manual GitHub security settings and release blockers.
