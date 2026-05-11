# AI-Assisted Development Disclosure Draft

Date: 2026-05-09
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1699a921928086b5b81e6bb48bee6be0691cfa88`

This is a factual draft for lawyer review. It should not be treated as a legal conclusion.

## Short Disclosure Draft

Carter developed the app using AI-assisted coding tools at times. AI tools helped with coding suggestions, debugging, tests, documentation, and planning. Carter directed the product design, architecture decisions, implementation choices, QA, deployment, and final acceptance of changes.

## Longer Optional Draft

BARK Ranger Map / BARK Ranger Premium was developed by Carter with the assistance of AI coding tools during portions of the development process. AI assistance was used for activities such as generating or revising code suggestions, debugging, writing and improving tests, reviewing Firebase/payment/security behavior, drafting technical documentation, and planning launch-readiness work. Carter remained responsible for product direction, feature decisions, code review, testing, acceptance of changes, deployment decisions, and business/legal follow-up.

## Known AI-Assisted Areas From Current Project Context

These areas should be disclosed as "AI-assisted at times" if Carter agrees they are accurate:

- Launch readiness and Firebase cost documentation.
- Private-beta hardening plans and QC reports.
- Firebase Functions, Firestore rules, entitlement, payment, and test planning/review.
- E2E/rules/functions test drafting and debugging.
- This legal/license/IP diligence packet.

Separate from development assistance, the app code includes Google/Gemini-related admin workflow dependencies and functions. That is a product/service usage issue, not just development assistance, and should be reviewed for privacy and service terms if admin data or user data is sent to AI services.

## Review / Testing Statement

AI-suggested changes were intended to be reviewed by Carter and tested through the repository's normal test and QA workflows before deployment. The repository contains many automated tests and hardening reports, but the lawyer should not treat the presence of tests as a warranty that all AI-generated code is legally or technically risk-free.

## Third-Party Proprietary Code Statement

No intentional copying of third-party proprietary source code was identified from this diligence search. This cannot prove that no third-party code exists in the repository. The dependency and asset audits should be reviewed alongside this disclosure.

## Recommended Lawyer Questions

1. Does AI-assisted development affect Carter's ownership representations?
2. Does any partner, investor, marketplace, or customer contract require AI-use disclosure?
3. Should contributor/contractor agreements mention AI-assisted tools?
4. Should Carter keep records of prompts, code review, and tests for key shipped features?
5. Does product use of Gemini/admin AI tooling require separate privacy or terms disclosure?
