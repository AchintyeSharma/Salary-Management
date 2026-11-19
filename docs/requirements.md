# ACME Salary Management Requirements

**Draft for review**

## Goal

Give ACME’s HR Manager a web application to maintain annual gross base pay for 10,000 employees across multiple countries and answer compensation questions without reconciling spreadsheets.

## What HR can do

- **Find and maintain employees.** Search by name or employee number and filter by country, department, level, and status. Add an employee with an opening salary. Correct name, department, or level. Deactivate and reactivate employees while retaining salary history.
- **Record salary changes.** Enter an immediate change in the employee’s local currency with a reason. View the previous and new pay, the actor, and the time. If another session changed the record since it was loaded, review the current data before submitting again.
- **Understand compensation.** See headcount, total annual base pay, and median by country, department, or level. Reports default to active employees and identify the cohort and currency basis. Cross-currency comparisons use a labelled synthetic USD exchange-rate snapshot.
- **Ask about pay.** Ask a supported question in plain language, review the interpreted filters and metric, and open the matching report. Use the dashboard directly when a question needs clarification or falls outside the supported reports.
- **Preview a raise.** After the hosted core is verified, estimate the cost of a percentage raise for a filtered active cohort. See headcount, current spend, projected spend, the difference, and a link to the matching directory filters. Previewing leaves employee records and pay history untouched.

## Deliberately deferred

- Spreadsheet import, bulk salary changes, and approvals require reconciliation and review workflows. The assessment starts with deterministic synthetic data.
- Scheduled and retroactive revisions, country or currency transfers, and historical aggregate reports require effective-dated data and correction rules. The assessment uses one authenticated HR role.

## Acceptance and delivery

- Starting from 10,000 seeded employees, HR can find an employee, save a salary revision, and see it after reloading. Profile corrections leave the salary history intact. Deactivation excludes the employee from active reports and blocks fresh salary edits. Reactivation restores inclusion.
- The dashboard and a confirmed pay question produce the same figures for the same filters and data. A raise preview reports matching current spend and leaves salary amounts and history intact.
