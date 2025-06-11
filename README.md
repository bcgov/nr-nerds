# nr-nerds

Issues, scripts and notes for Natural Resources team members.

## Project Sync Automation

This folder contains scripts and requirements for automating issue and pull request management across monitored bcgov repositories using a GitHub Projects v2 board.

### Overview
- Automation is driven by the rules in `project-board-sync/config/rules.yml` (the single source of truth).
- The sync runs every 30 minutes via a scheduled GitHub Actions workflow.
- Issues and PRs are automatically triaged and moved on the project board according to user-friendly, editable rules.

### How It Works
- All logic and configuration are defined in `config/rules.yml`.
- To change automation, simply edit `config/rules.yml` and open a PR (see CONTRIBUTING.md for guidelines).
- The script (`project-board-sync/project-board-sync.js`) reads the rules and updates the project board accordingly.

### Monitored Repositories
See the **monitored.repositories** section in `project-board-sync/config/rules.yml` for the current list. To add your repo, follow the contribution guidelines and open a PR.

### Contributing
- To propose a rule change, edit `config/rules.yml` or open an issue/PR.
- For more details, see `project-board-sync/CONTRIBUTING.md`.

---

For Natural Resources team notes and other scripts, see the rest of this repository.
