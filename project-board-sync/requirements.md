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

## Automation Rules for Projects

### 1. New Items - Set Column

| Item Type | From Column | To Column |
|-----------|-------------|-----------|
| PR        | None        | Active    |
| Issue     | None        | New       |

### 2. Column Rules - Set Sprint

| Item Type            | Column       | From Sprint | To Sprint      |
|----------------------|--------------|-------------|----------------|
| PR, Issue            | Next, Active | Any         | Current sprint |
| PR, Issue            | Done         | None        | Current sprint |

> Note: To optimize API usage, sprint updates will be skipped if the item already has the correct sprint assigned.

### 3. Linked Issue Rules - Set Column and Sprint

| Item Type    | Column  | PR Status     | To Column       |
|--------------|---------|---------------|-----------------|
| Linked Issue | Done    | Unmerged      | Unchanged       |
| Linked Issue | Any     | Anything else | Inherit from PR |

> Note: Linked issues are associated with a pull request (PR) via the "Linked issues" feature in GitHub.

## Automation Rules for Monitored Users and Repositories

### 4. Monitored Users and Repositories

| Type       | From Project            | To Project      |
|------------|-------------------------|-----------------|
| PR, Issue  | None, different Project | Current Project |

> Note: These rules apply to issues and pull requests assigned to the listed users or existing in the monitored repositories.

**Monitored Users**:
- User: `GITHUB_AUTHOR` (set by the environment variable)
  - All issues and PRs assigned to this user will be added to the project board
  - Issues assigned to this user will be placed in the "New" column
  - PRs assigned to this user will follow the standard PR column rules

**Monitored Repositories**: The following repositories are monitored for issues and pull requests:
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
- **Optimize API usage**: Skip unnecessary API calls when the target state already matches the current state (e.g., don't update a sprint assignment if it's already correctly assigned). This reduces API usage and improves performance.

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
