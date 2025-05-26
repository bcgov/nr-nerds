# Project Sync Requirements

_Last updated: 2025-05-26_

> **Purpose:** This requirements file is the single source of truth for all automation logic and will be referenced by both the user and AI assistant for all code changes. Any code modifications must be checked against this file to ensure all requirements are met and preserved.
> 
> **Usage:** To change automation, simply edit this file and ask Copilot to update the code to match. No coding knowledge required.
> 
> **Example:** After editing, you can:
> - Ask Copilot: "Please update the automation based on requirements.md" or "Sync the code with the latest requirements."
> - Or, create a GitHub issue or pull request referencing requirements.md and request an update. Copilot or a maintainer can then process the change.

## USER-FACING RULES

### 1. Assignment and Author Rules
- Monitor **any repository in these organizations:** `bcgov`
- Any items processed are added to this project board: **bcgov ProjectV2 (ID: PVT_kwDOAA37OM4AFuzg)**.
- **Any issue assigned to the user** (as set by `GITHUB_AUTHOR`) goes to the **"New"** column.
- **Any PR authored by the user** in any `bcgov` repo goes to the **"Active"** column.
- **Any issue linked to a PR** is handled exactly like that PR.

### 2. Issue-Import Repositories
- For any repo listed below, **any new issue** (regardless of assignee) is added to the **"New"** column **if it is not already in the project**.
- **If an issue or PR is already in the project (in any column), do not change its column.**
- **To add your own repositories to be issue-imported, simply add them to the list below:**

  - nr-nerds
  - quickstart-openshift
  - quickstart-openshift-backends
  - quickstart-openshift-helpers
  
  (All are assumed to be under the `bcgov` GitHub organization unless otherwise specified.)

### 3. Sprint Assignment
- Anything moved to the **Active** or **Done** columns should be assigned to the current Sprint.
- If an item is already in **Done** and has a Sprint assigned, do not update the Sprint.

---

## TECHNICAL/IMPLEMENTATION DETAILS

- Project column and field IDs are set in the script configuration.
- All errors, warnings, and info should be logged at the end of the run.
- Process changes in batches (default: 5 at a time, 2s delay between batches) to avoid GitHub secondary rate limits.
- All issues and PRs should be deduplicated by node ID before processing.
- Only process issues and PRs **updated in the last two days** (based on `updatedAt`). This rule applies to all automation logic above.

---

## HOW TO CONTRIBUTE

We welcome contributions from anyone interested in improving or extending this automation!

- **To propose a change to the automation rules:**
  - Edit this requirements.md file directly, or
  - Open a GitHub issue or pull request describing your suggestion.
- **To add your repository to the Issue-Import list:**
  - Simply add your repo name to the list in section 2 above. No approval required—if it’s in the list, it will be included!
- **For questions or help:**
  - Tag a maintainer in an issue or discussion, or reach out in your team’s preferred channel.

Please keep this file clear and user-friendly for everyone. Thank you for helping make our automation better!
