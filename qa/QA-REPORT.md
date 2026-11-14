# WorkMars — QA Test Report

**Build under test:** branch `claude/pensive-lovelace-w7hn4l` (logo + 75% desktop scale release)
**Date:** 14 November 2026
**Verdict:** ✅ **Pass — release-ready**, with one known dependency risk (see R-1).

| Gate | Result |
|---|---|
| Static analysis (TypeScript, strict) | ✅ 0 errors |
| Unit + integration (white-box), SQLite | ✅ 63 / 63 |
| Unit + integration (white-box), PostgreSQL 16 | ✅ 63 / 63 |
| Security & negative suite (new) | ✅ 11 / 11 |
| Browser acceptance (black-box UAT) | ✅ 25 / 25, three consecutive clean runs |
| Regression after fixes | ✅ all suites re-run green |
| Dependency audit | ⚠️ 2 of 3 advisories fixed; 1 needs a major upgrade |

---

## 1. Scope and approach

| Technique | What was done |
|---|---|
| **White-box** | Code coverage measured on the server; source reviewed for SQL injection, raw HTML, auth gaps and leaked secrets; route list read from source so every endpoint is tested. |
| **Black-box (API)** | All 120 API routes called as an anonymous user, as a user from another company, and with each role (admin, manager, member, viewer). |
| **Black-box (UI) / UAT** | Real Chromium driving the production build through 18 user stories, the same way a person would (typing, clicking, dragging, shortcuts). |
| **Negative / fuzz** | Malformed JSON, oversized bodies, wrong types, impossible dates, SQL/script injection, prototype pollution, path traversal, huge or negative ids. |
| **Security** | Tenant isolation (IDOR), role escalation, CSRF, session revocation, cookie flags, account enumeration, security headers, Content-Security-Policy, dependency CVEs. |
| **Compatibility / responsive** | Phone 390 px, tablet 820 px, laptop 1366 px, desktop 1920 px: no sideways scrolling on 11 key pages each. |
| **Accessibility** | Accessible names on controls, labels on inputs, alt text, page language, visible keyboard focus. |
| **Performance** | Load time, Largest Contentful Paint, JavaScript transferred. |
| **Regression** | Every fix verified, then all suites re-run on both databases; the new suites are committed so they run on every future change. |

## 2. White-box results

**Server line coverage:** 85–100 % per module. Strong areas: access control 100 %, auth 98 %, two-step codes 100 %, time tracking 100 %. Weakest: `realtime.js` 49 % (live-update stream; exercised by the browser suite, not by unit tests).

**Code review findings**
- SQL: every dynamic fragment is a code constant (column maps, `?` placeholder lists); all values are bound parameters. **No injection paths.**
- Raw HTML: only the static icon sprite. **No XSS sinks.**
- Auth: 105 of 120 routes require a session. The 15 that don't are meant to be public: sign-up, login, password reset, Google sign-in, invite preview, share page, calendar feed.

## 3. Security results

| Test | Result |
|---|---|
| Anonymous access to 105 protected routes | ✅ all 401 |
| Company B's admin replaying **every route** with company A's real ids (project, issue, comment, file, time entry, to-do, share link, integration, invite…) | ✅ no access, no data leaked, company A's data byte-for-byte unchanged |
| Viewer tries to create, edit, delete or rename | ✅ refused |
| Member tries to rename workspace, upload logo, invite admins, change roles, remove people, read audit log, delete project | ✅ refused; nobody escalated |
| Forged request without the app header (CSRF) | ✅ refused |
| Password change revokes other sessions; tampered cookie rejected; cookie `HttpOnly` + `SameSite` | ✅ |
| Login and forgot-password don't reveal which emails exist | ✅ |
| Emailed invite opened while signed in as someone else | ✅ refused, offers "sign out and continue as …" |
| Two-step sign-in: wrong code rejected, right code accepted | ✅ |
| Rate limits on sign-up, login, 2FA codes, password, invites | ✅ present (enforced in production mode) |

## 4. Acceptance (UAT) results — 25 / 25

| ID | User story | Result |
|---|---|---|
| UAT-01 | Landing page, CTAs | ✅ |
| UAT-02 | Sign-up validation (bad email, short password) | ✅ |
| UAT-03 | Sign up | ✅ |
| UAT-04 | Onboarding, organisation logo upload, open project | ✅ |
| UAT-05 | Create a work item with the **C** shortcut | ✅ |
| UAT-06 | Drag a card to another column; persists after reload | ✅ |
| UAT-07 | Comment, checklist, log time on a work item | ✅ |
| UAT-08 | Command palette (Ctrl+K) search | ✅ |
| UAT-09 | My day: add, complete, persist a to-do | ✅ |
| UAT-10 | 15 main pages render with no errors | ✅ |
| UAT-11 | Invite by email (email delivered with link) | ✅ |
| UAT-12 | Invite opened in the wrong account is refused safely | ✅ |
| UAT-13 | Invitee signs up from the email and lands in the workspace | ✅ |
| UAT-14 | Member permissions enforced in the UI and API | ✅ |
| UAT-15 | Logout; wrong password rejected; correct password works | ✅ |
| UAT-16 | Two-step sign-in end to end | ✅ |
| UAT-17 | Forgot password → email → reset works once only | ✅ |
| UAT-18 | Public share link works signed out, hides comments, dies when revoked | ✅ |
| RWD ×4 | Phone, tablet, laptop, desktop: no sideways scrolling | ✅ |
| A11Y | Names, labels, alt text, language, visible focus | ✅ |
| PERF | Load 0.8–0.9 s, LCP ≈ 0.6 s, JS 469 KB | ✅ |
| CSP | Zero CSP violations and zero console errors across the whole run | ✅ |

## 5. Defects found and fixed

| ID | Severity | Defect | Fix | Verified by |
|---|---|---|---|---|
| D-1 | **Medium** (security hardening) | No Content-Security-Policy header. | Strict CSP: API responses can run nothing; pages run only their own scripts, with the two inline scripts allowed by SHA-256 hash; framing blocked. | security test + zero CSP violations in UAT |
| D-2 | **Medium** (data integrity) | Impossible dates such as `2026-02-31` or `2026-13-01` were accepted (format-only check) for due dates, sprints, to-dos and date fields. | Real calendar-date validation everywhere. | unit test |
| D-3 | **Medium** (UX, blocks onboarding) | On "Bring your team", typing a name instead of an email and clicking **Finish** did nothing: the text vanished silently, the button jumped under the cursor, no message. | Invalid entries stay in the box with a clear error; valid ones become chips; addresses left in the box are included on Finish. | 4 scenario checks + UAT-04 |
| D-4 | **Low** (accessibility) | Keyboard focus ring was dark olive on the dark sidebar, so it was effectively invisible. | Lime focus ring on all dark surfaces. | UAT-A11Y |
| D-5 | **Low** (cosmetic) | "You're all clear" heading left-aligned while its icon and text are centred. | Scoped style fix. | measured centring |
| D-6 | **High** (dependency) | `body-parser` DoS advisory (GHSA-27r3-jxmh-p828). | Patched via `npm audit fix`. | audit + full regression |
| D-7 | **Moderate** (dependency) | `qs` DoS advisory (GHSA-6pq8-jhm2-2vcw). | Patched via `npm audit fix`. | audit + full regression |
| D-8 | Low (housekeeping) | `package.json` still described the removed AI guide. | Updated. | — |

## 6. Open risks and recommendations

| ID | Risk | Recommendation |
|---|---|---|
| R-1 | **zod 3.x advisory** (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized collections). Fix exists only in zod 4, a breaking upgrade. Exposure is limited because every JSON body is capped at 256 KB. | Schedule a zod 3 → 4 migration as its own change, with the full suite as the safety net. |
| R-2 | The web app has no unit-test runner; it's covered by the browser suite only. | Add Vitest for pure helpers (date formatting, key suggestion, email parsing) when convenient. |
| R-3 | `realtime.js` (live updates) has 49 % unit coverage. | Add a unit test for subscribe/unsubscribe and workspace scoping. |
| R-4 | Rate limits are generous outside production mode by design. | Make sure production runs with `NODE_ENV=production`. |
| R-5 | Logo images in emails load from the app's address, so they won't show while running on `localhost`. | Expected; verify once deployed. |

## 7. How to re-run

```bash
npm run check                         # types + 63 server tests + production build
TEST_DATABASE_URL=postgres://… npm test   # same tests on PostgreSQL
npm run e2e:server                    # terminal 1: app on an in-memory DB, emails captured
npm run e2e                           # terminal 2: 25 browser acceptance checks (needs Playwright + Chromium)
```
