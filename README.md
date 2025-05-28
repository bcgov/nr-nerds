# nr-nerds

Issues, scripts and notes for Natural Resources team members.

## Project Sync Automation

This folder contains scripts and requirements for automating issue and pull request management across monitored bcgov repositories using a GitHub Projects v2 board.

### Overview
- Automation is driven by the rules in `project-board-sync/requirements.md` (the single source of truth).
- The sync runs every 30 minutes via a scheduled GitHub Actions workflow.
- Issues and PRs are automatically triaged and moved on the project board according to user-friendly, editable rules.

### How It Works
- All logic and configuration are defined in `requirements.md`.
- To change automation, simply edit `requirements.md` and request a sync (see instructions in that file).
- The script (`project-board-sync/project-board-sync.js`) reads the requirements and updates the project board accordingly.

### Monitored Repositories
See the **Monitored Repositories** section in `requirements.md` for the current list. To add your repo, just edit the list and request a sync.

### Contributing
- To propose a rule change, edit `requirements.md` or open an issue/PR.
- For more details, see the **How to Contribute** section in `requirements.md`.

---

For Natural Resources team notes and other scripts, see the rest of this repository.
