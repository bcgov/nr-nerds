# Project Sync Requirements

_Last updated: 2025-05-26_

## Overview
This file is the single source of truth for all automation logic that manages issues and pull requests across monitored `bcgov` repositories using a GitHub Projects v2 board. The automation runs every 30 minutes via a scheduled GitHub Actions workflow.

To change automation, simply edit this file and request a sync—no coding required. For example:
- Edit the rules or repository list below.
- Ask Copilot: "Please update the automation based on requirements.md" or "Sync the code with the latest requirements."
- Or, create a GitHub issue or pull request referencing requirements.md and request an update.

All code changes must follow the requirements in this file.

## Scope
- Organization: `bcgov`
- Project Board: `ProjectV2` with ID `PVT_kwDOAA37OM4AFuzg`
- User: `GITHUB_AUTHOR` (set by the environment variable)

## Project Board Rules
- Any item in the **"Next"** or **"Active"** columns should be assigned to the current Sprint, even if a Sprint is already assigned.
- Any item moved to the **"Done"** column should be assigned to the current Sprint if not already assigned.

## User Rules
- **Any PR authored by the user**:
  - New PR: Move to **"Active"**.
  - PR closed: Move to **"Done"**.
- **Any issue linked to a PR**:
  - New link: inherit the sprint and column from its PR.
  - PR merged: inherit the sprint and column from its PR.
  - PR closed: do not change the issue's column or sprint.

## Monitored Repository Rules
- For repositories listed below:
  - **Any new issue not in the project** is added to the **"New"** column.
  - **Any issue already in the project** is unaffected.

## Monitored Repositories
- nr-nerds
- quickstart-openshift
- quickstart-openshift-backends
- quickstart-openshift-helpers

_All repositories listed above are under the `bcgov` GitHub organization unless otherwise specified._

## Technical Details
- The sync automation runs every 30 minutes via a scheduled GitHub Actions workflow.
- Project column and field IDs are set in the script configuration. This is expected to become dynamic in the future.
- All errors, warnings, and info should be logged at the end of the run.
- Process changes in batches (default: 5 at a time, 2s delay between batches) to avoid GitHub secondary rate limits.
- All issues and PRs should be deduplicated by node ID before processing.
- Only process issues and PRs **updated in the last two days** (based on `updatedAt`). This rule applies to all automation logic above.

---

## How to Contribute

We welcome contributions from anyone interested in improving or extending this automation!

- **To propose a change to the automation rules:**
  - Edit this requirements.md file directly, or
  - Open a GitHub issue or pull request describing your suggestion.
- **To add your repository to the Monitored Repositories list:**
  - Simply add your repo name to the list above. No approval required—if it’s in the list, it will be included!
- **For questions or help:**
  - Tag a maintainer in an issue or discussion, or reach out in your team’s preferred channel.

Please keep this file clear and user-friendly for everyone. Thank you for helping make our automation better!
