## Change

Describe the problem and resulting behavior. Link the task/issue and note risk.

## Verification

- [ ] Focused checks during development; commands and actual results listed below.
- [ ] `npm run verify:ci` or the matching Actions check passed.
- [ ] MySQL integration CI passed for database/authentication/payment changes.
- [ ] npm audit findings reviewed, including development dependencies.
- [ ] Pages demo and production startup guards preserved.
- [ ] No secrets, private previews, customer data or generated artifacts included.
- [ ] Authentication/RBAC, ownership, CSRF, webhook signatures and idempotency preserved.

Results (PASS / FAIL / NOT VERIFIED):

## Migration review (mark N/A with a reason if no schema/data change)

- [ ] Both SQLite and MySQL schemas/behavior reviewed; generated clients excluded.
- [ ] New SQL reviewed for locks, partial DDL failure, collation, indexes, foreign
      keys, uniqueness, nullable/default columns and existing-data compatibility.
- [ ] Previously applied migrations and checksums unchanged.
- [ ] Fresh disposable replay and both database integration suites passed.
- [ ] Existing-data upgrade/restore rehearsal and backup evidence recorded if applicable.
- [ ] Exact target, least-privileged account, backup, rollout order, verification,
      failure stop condition and forward-repair/restore plan documented.
- [ ] Separate explicit approval obtained before any persistent/remote migration;
      no reset, destructive baseline or unreviewed migration resolution.

## Review and release

- [ ] Diff reviewed; conversations resolved; unrelated changes excluded.
- [ ] Release blockers and manual acceptance work documented.
- [ ] Commit/push/merge/tag/deployment each has the required explicit authorization.
