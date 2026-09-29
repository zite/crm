# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's advisory form](https://github.com/zite/crm/security/advisories/new),
or email **security@zite.com**. We will acknowledge within three working days and
keep you updated until it is resolved. If you would like credit in the advisory,
say so and we will include you.

## Scope

This repository is a **template**. It is installed into a workspace that you run,
so a report against it is about the application code here: endpoint
authorization, data exposure between people or organizations, injection through
user-supplied content, that kind of thing.

Vulnerabilities in the **Zite platform itself** (auth, the endpoint runtime,
hosting) go to security@zite.com too, but say which you mean.

## What we already know and treat as by design

- The sample data an admin can load from Settings → General is public
  content: a fictional company, its pipeline and contacts.
- CRM Pages is an external app serving web forms, meeting booking, quotes and
  unsubscribe links. Those pages are deliberately public and unauthenticated;
  each is scoped to one record by an unguessable id.
- Roles (Admin, Manager, Rep, Viewer) are enforced in endpoints, not only in the UI.

## Supported versions

This is a template rather than a released library. Fixes land on `main` and you
pick them up by merging. There are no maintained release branches.
