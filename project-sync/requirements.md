# Project Sync Requirements

_Last updated: 2025-05-26_

> **Purpose:** This requirements file is the single source of truth for all automation logic and will be referenced by both the user and AI assistant for all code changes. Any code modifications must be checked against this file to ensure all requirements are met and preserved.
> 
> **Usage:** To change automation, simply edit this file and ask Copilot to update the code to match. No coding knowledge required.
> 
> **Example:** After editing, you can:
> - Ask Copilot: "Please update the automation based on requirements.md" or "Sync the code with the latest requirements."
> - Or, create a GitHub issue or pull request referencing requirements.md and request an update. Copilot or a maintainer can then process the change.

## SCOPE
- Organization: `bcgov`
- Project Board: `ProjectV2` with ID `PVT_kwDOAA37OM4AFuzg`
- User: `GITHUB_AUTHOR` (set by the environment variable)

## PROJECT BOARD RULES
- Any item in the **"Next"** or **"Active"** columns should be assigned to the current Sprint, even if a Sprint is already assigned.
- Any item moved to the **"Done"** column should be assigned to the current Sprint if not already assigned.

## USER RULES
- **Any issue assigned to the user**:
  - Move to the **"New"** column.
- **Any PR authored by the user**:
  - New PR: Move to **"Active"**, assign to current Sprint.
  - PR merged: Move to **"Done"**, assign to current Sprint if not already assigned (includes linked issues).
  - PR closed without merging: Move to **"Done"**, assign to current Sprint if not already assigned (does not affect linked issues).
- **Any issue linked to a PR**:
  - If the PR is merged: Move to **"Done"**, assign to current Sprint if not already assigned.
  - If the PR is closed without merging: Do not change the issue's column or Sprint.

## REPOSITORY RULES
- For any repository listed below, **any new issue** (regardless of assignee) is added to the **"New"** column if it is not already in the project. No Sprint is assigned.
- If an issue or PR is already in the project (in any column), do not change its column or Sprint.
- **To add your own repositories to be issue-imported, simply add them to the list below:**
  - nr-nerds
  - quickstart-openshift
  - quickstart-openshift-backends
  - quickstart-openshift-helpers

## TECHNICAL DETAILS
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
  - Simply add your repo name to the list in the Repository Rules section above. No approval required—if it’s in the list, it will be included!
- **For questions or help:**
  - Tag a maintainer in an issue or discussion, or reach out in your team’s preferred channel.

Please keep this file clear and user-friendly for everyone. Thank you for helping make our automation better!
