# Project Sync Requirements

> **Migration Status:** These requirements are being migrated to `config/rules.yml`.
> This document will be maintained until:
> 1. All rules are verified in YAML configuration
> 2. All behavior matches these requirements exactly
> 3. Full test coverage confirms correct implementation
> 
> Do not delete this document until migration is complete and verified.

## Migration Progress Tracking

| Rule Set | Status | Verification | Notes |
|----------|--------|--------------|-------|
| Board Addition Rules | ⏳ In Progress | Partially Tested | PR/Issue rules migrated |
| Column Rules | 🔄 Migrated | Needs Testing | All rules in YAML |
| Sprint Rules | 🔄 Migrated | Needs Testing | Sprint logic transferred |
| Linked Issue Rules | 🔄 Migrated | Needs Testing | Dependency rules moved |
| Assignee Rules | ⏳ In Progress | Needs Testing | Author assignment pending |

Legend:
- ⏳ In Progress: Rule migration started
- 🔄 Migrated: Rules transferred to YAML
- ✅ Verified: Rules tested and confirmed working
- ❌ Failed: Issues found in testing

_Last updated: 2025-06-03_

## Overview
This file is the single source of truth for all project board automation logic.

To change automation, simply edit this file and request a sync—no coding required. For example:
- Edit the rules or repository list below.
- Ask Copilot: "Please update the automation based on requirements.md" or "Sync the code with the latest requirements."
- Or, create a GitHub issue or pull request referencing requirements.md and request an update.

## Rule Adherence and Quality
The following principles must be followed to maintain strict adherence to requirements:

1. **Rules Are Explicit** - If something isn't in the rules tables above, it should not be implemented.
2. **No Implicit Behavior** - All automation must map directly to a rule in this file.
3. **Test Against Rules** - Tests must verify behavior against these requirements, not implementation.

If you find yourself making assumptions about how something should work, stop and:
1. Check if there's an explicit rule for it
2. If not, propose an addition to this file first
3. Only implement after the rule is documented

## Automation Rules for Projects Board Sync

### 1.  Which Items are Added to the Project Board?

| Item Type | Trigger Condition             | Action               | Skip Condition     |
|-----------|-------------------------------|----------------------|--------------------|
| PR        | Authored by monitored user    | Add to project board | Already in project |
| PR        | Assigned to monitored user    | Add to project board | Already in project |
| PR        | Found in monitored repository | Add to project board | Already in project |
| Issue     | Found in monitored repository | Add to project board | Already in project |

**Project Board** (ProjectV2 only):
- ID: `PVT_kwDOAA37OM4AFuzg` (will eventually be dynamic)

**Monitored Users**:
- User: `GITHUB_AUTHOR` (environment variable)

**Monitored Repositories**:
- action-builder-ghcr
- nr-nerds
- quickstart-openshift
- quickstart-openshift-backends
- quickstart-openshift-helpers

_All repositories listed above are under the `bcgov` GitHub organization unless otherwise specified._

### 2. Which Columns are Items Added To?

| Item Type | Trigger Condition | Action        | Skip Condition         |
|-----------|-------------------|---------------|------------------------|
| PR        | Column=None       | Column=Active | Column=Any already set |
| PR        | Column=New        | Column=Active | Column=Any except New  |
| Issue     | Column=None       | Column=New    | Column=Any already set |

_GitHub Project automation may pick up PRs first, so we need the extra New=>Active rule._

### 3. Which Sprints are Items Assigned To?

| Item Type | Trigger Condition   | Action         | Skip Condition             |
|-----------|---------------------|----------------|----------------------------|
| PR, Issue | Column=Next, Active | Sprint=current | Sprint=current already set |
| PR, Issue | Column=Done         | Sprint=current | Sprint=any already set     |

### 4. What About Issues Linked to Pull Requests?

| Item Type    | Trigger Condition     | Action                    | Skip Condition           |
|--------------|-----------------------|---------------------------|--------------------------|
| Linked Issue | PR != closed+unmerged | Inherit column, assignees | Column, already match PR |

> Note: Linked issues are associated with a pull request (PR) via the "Linked issues" feature in GitHub.

### 5. What About Assignees?

| Item Type | Trigger Condition     | Action                 | Skip Condition         |
|-----------|-----------------------|------------------------|------------------------|
| PR        | Author=monitored user | Add author as assignee | Assignee already set   |

## Technical Details
- The sync automation runs every 30 minutes via a scheduled GitHub Actions workflow.
- All errors, warnings, and info should be logged at the end of the run.
- Process changes in batches (default: 10 at a time, 1s delay between batches) to avoid GitHub secondary rate limits.
- All issues and PRs should be deduplicated by node ID before processing.
- Only process issues and PRs **updated in the last 24 hours** (based on `updatedAt`). This rule applies to all automation logic above.
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
