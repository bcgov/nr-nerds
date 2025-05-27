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

## Project Automation Rules

| Rule # | Trigger/Condition | Item Type | Action/Status | Sprint Assignment | Notes/Reasoning |
|--------|------------------|-----------|---------------|------------------|-----------------|
| 1 | PR authored by `${GITHUB_AUTHOR}` is opened | PR | Move to **Active** | Assign to current Sprint | Applies to any repository, not just monitored repos |
| 2 | PR authored by `${GITHUB_AUTHOR}` is merged or closed | PR | Move to **Done** | Assign to current Sprint (if not already set) | Merged or closed PRs only |
| 3 | Issue is newly created in monitored repo | Issue | Add to **New** | _None_ | Only if not already in project |
| 4 | Issue already exists in project | Issue | _No change_ | _No change_ | Skipped by automation |
| 5 | PR (open or merged) has linked issues | Issue (linked) | Inherit PR status (**Active** or **Done**) | Inherit PR's Sprint (assign if not already set) | Only for PRs authored by `${GITHUB_AUTHOR}` |
| 6 | PR is closed but not merged | Issue (linked) | _No change_ | _No change_ | Linked issues not updated |
| 7 | Item in **Next** or **Active** | Any | Ensure assigned to current Sprint | Always update | |
| 8 | Item in **Done** | Any | Ensure assigned to current Sprint | Only if not already set | |

**Legend:**  
- "Inherit" means the linked issue gets the same status/sprint as its PR.  
- "Assign to current Sprint" means set the Sprint field to the current iteration.  
- `${GITHUB_AUTHOR}` is the configured GitHub username for automation.

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
