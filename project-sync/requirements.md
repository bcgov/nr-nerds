# Project Sync Requirements

_Last updated: 2025-05-26_

## Overview
This file is the single source of truth for all automation logic that manages issues and pull requests across monitored `bcgov` repositories using a GitHub Projects v2 board. The automation runs every 30 minutes via a scheduled GitHub Actions workflow.

To change automation, simply edit this file and request a sync—no coding required. For example:
- Edit the rules or repository list below.
- Ask Copilot: "Please update the automation based on requirements.md" or "Sync the code with the latest requirements."
- Or, create a GitHub issue or pull request referencing requirements.md and request an update.

## Scope
- Organization: `bcgov`
- Project Board: `ProjectV2` with ID `PVT_kwDOAA37OM4AFuzg`
- User: `GITHUB_AUTHOR` (set by the environment variable)

## Automation Rules

### 1. Project Board Column Rules

| Item Location/Action | Sprint Assignment | User Assignment |
|---------------------|------------------|----------------|
| Item in **"Next"** column | Assign to current Sprint (always) | No change |
| Item in **"Active"** column | Assign to current Sprint (always) | No change |
| Item moved to **"Done"** column | Assign to current Sprint (only if not already assigned) | No change |

### 2. User-Authored PR Rules

| PR State | Column Action | Sprint Assignment | User Assignment |
|----------|--------------|------------------|----------------|
| New PR | Move to **"Active"** | Assign to current Sprint | Assign to PR author |
| PR closed (not merged) | Move to **"Done"** | Assign to current Sprint (if not assigned) | No change |
| PR merged | Move to **"Done"** | Assign to current Sprint (if not assigned) | No change |

### 3. Linked Issue Inheritance Rules

| PR State | Linked Issue Column | Linked Issue Sprint | Linked Issue User |
|----------|-------------------|-------------------|------------------|
| PR is open | Inherit from PR | Inherit from PR | Inherit from PR |
| PR is merged | Inherit from PR | Inherit from PR | Inherit from PR |
| PR is closed (not merged) | No change | No change | No change |

### 4. Repository Monitoring Rules

| Issue State | Project Board Action |
|------------|---------------------|
| New issue not in project | Add to **"New"** column |

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
- Process changes in batches (default: 10 at a time, 1s delay between batches) to avoid GitHub secondary rate limits.
- All issues and PRs should be deduplicated by node ID before processing.
- Only process issues and PRs **updated in the last two days** (based on `updatedAt`). This rule applies to all automation logic above.

---

## How to Contribute

We welcome contributions from anyone interested in improving or extending this automation!

- **To propose a change to the automation rules:**
  - Open a GitHub pull request with your proposed changes to this requirements.md file, or
  - Open a GitHub issue describing your suggestion.
- **To add your repository to the Monitored Repositories list:**
  - Simply add your repo name to the list above. No approval required—if it’s in the list, it will be included!
- **For questions or help:**
  - Tag a maintainer in an issue or discussion, or reach out in your team’s preferred channel.

Please keep this file clear and user-friendly for everyone. Thank you for helping make our automation better!
