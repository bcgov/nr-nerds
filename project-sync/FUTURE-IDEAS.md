# Project Sync: Future Enhancements and Ideas

This file tracks potential improvements and future work for the project-sync automation. Each item can be promoted to a GitHub issue or PR as needed.

## 1. Dry-Run Mode
- Add a command-line or config option to run the script in "dry run" mode, where no changes are made to GitHub, but all actions are logged as if they would be performed.
- Useful for testing changes to requirements or code without affecting the project board.

## 2. Audit Trail / State Diff Logging
- Implement a feature to log the before/after state of each project item that is changed.
- Optionally, write a summary of all changes to a file for later review or rollback.

## 3. Unit Tests for Requirements Parsing and Item Selection
- Add unit tests for the logic that parses requirements.md and selects issues/PRs for processing.
- Ensure that changes to requirements or code do not break expected automation behavior.

## 4. Modularize Requirements Parsing and Action Logic
- Refactor the script to further separate requirements parsing from action logic.
- Make it easier to add new rules or support more organizations in the future.

## 5. Support for More Organizations or Custom Rules
- Allow configuration of additional organizations or custom rules in requirements.md.
- Make the script more flexible for multi-org or multi-project use cases.

## 6. Enhanced Logging and Diagnostics
- Add more granular logging (e.g., per-repo, per-action) and allow output to a file as well as the console.
- Optionally, add a summary of skipped items with reasons to a separate log file.

---

If you want to work on any of these, create a GitHub issue and reference this file for details.
