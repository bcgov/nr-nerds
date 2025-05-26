# Project Sync Requirements

_Last updated: 2025-05-25_

> **Note:** This requirements file is the single source of truth for all automation logic and will be referenced by both the user and AI assistant for all code changes. Any code modifications must be checked against this file to ensure all requirements are met and preserved.

## 1. General Scope
- This script manages issues and PRs across all `bcgov` repositories and a GitHub Projects v2 board.
- It uses the GitHub GraphQL API for all queries and updates.

## 2. Rules for Project Board Automation

### 2.1. All `bcgov` Repos
- **Any issue assigned to the user** (as set by `GITHUB_AUTHOR`) in any `bcgov` repo goes to the **"New"** column.
- **Any PR authored by the user** in any `bcgov` repo goes to the **"Active"** column.
- **Any issue linked to a PR** authored by the user is also moved to **"Active"** (with the PR).

### 2.2. Managed Repos (see Managed Repositories below)
- For any repo listed in the **Managed Repositories** section, **any new issue** (regardless of assignee) is added to the **"New"** column **if it is not already in the project and was updated in the last two days**.
- **If an issue or PR is already in the project (in any column), do not change its column.**
- Do not move issues or PRs that have not been updated in the last two days.

### 2.3. Time Filtering
- Only process issues and PRs **updated in the last two days** (based on `updatedAt`).

### 2.4. Sprint Assignment
- Anything moved to the **Active** or **Done** columns should be assigned to the current Sprint.
- If an item is already in **Done** and has a Sprint assigned, do not update the Sprint.

### 2.5. Deduplication
- All issues and PRs should be deduplicated by node ID before processing.

### 2.6. Rate Limiting
- Project item updates should be processed in batches (default: 5 at a time, 2s delay between batches) to avoid GitHub secondary rate limits.

### 2.7. Closed Items
- Any issue or PR (including those that are closed or merged) that was updated in the last two days should be processed according to the same rules as open items.
- Closed issues/PRs should be moved to the appropriate column (e.g., "Done") and assigned to the current Sprint if moved to "Done" and not already assigned.
- All other rules (deduplication, batching, logging, etc.) apply equally to closed items.

### 2.8. Reopening Issues Moved to Active
- If an issue is moved to the "Active" column and it is currently closed, the script must reopen the issue.
- Do not change the column (it remains in "Active").
- Assign the issue to the current Sprint if it is moved to "Active".
- This applies to all rules that move issues to "Active" (including linked issues following PRs).

## 3. Managed Repositories
- The following repositories are managed for the purposes of automation:

  - nr-nerds
  - quickstart-openshift
  - quickstart-openshift-backends
  - quickstart-openshift-helpers

  (All are assumed to be under the `bcgov` GitHub organization unless otherwise specified.)

## 4. Configuration
- Project column and field IDs are set in the script configuration.

## 5. Logging & Diagnostics
- All errors, warnings, and info should be logged at the end of the run.

---

**Change Management:**
- Any future code changes must be checked against this requirements file to ensure all requirements are still met.
- If requirements change, update this file first, then update the code.
