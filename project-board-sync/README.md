# Project Sync

A GitHub Projects v2 automation tool for synchronizing issues and pull requests across multiple repositories.

## Overview

This tool automates the management of GitHub Projects v2 boards based on configurable rules. It handles:

- Adding PRs and issues to the project board
- Assigning users to PRs and issues
- Moving items to the appropriate columns based on state
- Managing sprint assignments
- Processing linked issues when PRs are merged

## Configuration

All automation is configured in `config/rules.yml`. The configuration includes:
- Project settings
- Monitored repositories and users
- Business rules for automation
- Performance settings

See `TECHNICAL.md` for implementation details and `CONTRIBUTING.md` for development guidelines.

## Files

- `project-board-sync.js`: The main script that runs the automation
- `config/rules.yml`: Source of truth for all automation rules
- `TECHNICAL.md`: Implementation details and architecture
- `CONTRIBUTING.md`: Development guidelines and processes
- `FUTURE-IDEAS.md`: Ideas and plans for future enhancements
- `fetch-user-assignments.js`: Utility to find issues and PRs assigned to users

## Tests

Test scripts are located in the `tests/` directory. See the [tests README](tests/README.md) for more information.

## Usage

### Running Preflight Checks

Before running the full sync, you can validate your environment and configuration:

```bash
# Set required environment variables
export GITHUB_TOKEN=your_github_token
export GITHUB_AUTHOR=your_github_username

# Run just the preflight checks to validate configuration
node tests/test-preflight-checks.js
```

The preflight checks validate:
- Environment variables
- GitHub API connectivity
- Sprint assignment logic
- Monitored repositories configuration
- Project configuration
- User assignment functionality
- Sprint configuration
- Specific issue handling

### Running the Full Sync

To run the project sync automation:

```bash
# Set required environment variables
export GITHUB_TOKEN=your_github_token
export GITHUB_AUTHOR=your_github_username

# Run with verbose output (recommended for troubleshooting)
VERBOSE=true node project-board-sync.js

# Run without verbose output (for production)
node project-sync.js

# Run with strict preflight checks (will exit on any check failure)
STRICT_MODE=true node project-sync.js
```

The script is typically run via GitHub Actions on a scheduled basis (every 30 minutes).

All preflight checks are run automatically at the start of the script to ensure proper configuration and connectivity before any changes are made.
