# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub: **Security → Report a vulnerability** on this repository
(private vulnerability reporting). Include what you found, how to reproduce it and the impact.

You will get an answer within a few days. Please give a reasonable time to release a fix before
disclosing the issue publicly.

## Scope

- The AAC code in this repository (backend, frontend, Docker images, CI).
- The hosted instance at https://aac.run — test only with your own account, do not access other
  users' data, and do not run denial-of-service or automated high-volume scans.

## Supported versions

Only the latest images (`:latest` from `main`, `:staging` from `staging`) receive fixes.
