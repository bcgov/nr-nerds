# Project Sync: Future Enhancements and Ideas

This file tracks potential improvements and future work for the project-sync automation. Each item can be promoted to a GitHub issue or PR as needed.

## User Assignment Enhancements

### 1. Support for Multiple Assignees
- Enhance the `assignUserToProjectItem` function to support multiple assignees
- Add configuration for team assignments based on repository or PR/issue type
- Useful for larger teams with specialized roles or for assigning both a primary and backup resource

### 2. Content-Based User Assignment
- Add logic to assign different users based on content of PR or issue
- Examples: Assign security team members for security-related PRs, documentation team for doc changes
- Could use labels, PR title keywords, or file paths to determine appropriate assignee

### 3. User Assignment Configuration Options
- Add configurable options for user assignment behavior in rules.yml
- Options could include:
  - `assignPRsToAuthor`: Whether to automatically assign PRs to their author
  - `inheritAssigneesForLinkedIssues`: Whether linked issues inherit PR assignees
  - `preserveExistingAssignees`: Whether to keep existing assignees when updating
  - `defaultAssignee`: The default user to assign when no specific user is determined
    - Examples: Fallback user for PRs with no author, default maintainer for new issues, or a team account for workflow automation

## 1. Dry-Run Mode
- Add a command-line or config option to run the script in "dry run" mode, where no changes are made to GitHub, but all actions are logged as if they would be performed.
- Useful for testing changes to requirements or code without affecting the project board.

## 2. Audit Trail / State Diff Logging
- Implement a feature to log the before/after state of each project item that is changed.
- Optionally, write a summary of all changes to a file for later review or rollback.

## 3. Unit Tests for Requirements Parsing and Item Selection
- Add unit tests for the logic that parses rules.yml and selects issues/PRs for processing.
- Ensure that changes to requirements or code do not break expected automation behavior.

## 4. Improve Test Coverage for Author Assignment
- Add tests to verify author information is correctly passed through from `add-items.js` to `assignees.js`
- Test cases needed:
  - PR authored by monitored user but in non-monitored repo
  - PR in monitored repo but authored by someone else
  - PR authored by monitored user and in monitored repo
  - Verify author field is preserved in object passed between modules
- Goal: Prevent future regressions in assignee logic when modifying data passed between modules

## 5. Modularize Requirements Parsing and Action Logic
- Refactor the script to further separate requirements parsing from action logic.
- Make it easier to add new rules or support more organizations in the future.

## 6. Support for More Organizations or Custom Rules
- Allow configuration of additional organizations or custom rules in rules.yml
- Make the script more flexible for multi-org or multi-project use cases.

## 7. Enhanced Logging and Diagnostics
- Add more granular logging (e.g., per-repo, per-action) and allow output to a file as well as the console.
- Optionally, add a summary of skipped items with reasons to a separate log file.

## 8. Slack/Teams/Email Notifications
- Integrate with Slack, Microsoft Teams, or email to send notifications for key automation events, errors, or summary reports.

## 9. Web Dashboard or Status Page
- Build a simple web dashboard to visualize project sync status, recent changes, errors, and upcoming sprints.

## 10. Configurable Batch Size and Rate Limits
- Allow batch size and API rate limit settings to be configured via rules.yml or environment variables for easier tuning.

## 11. Self-Check/Healthcheck Command
- Add a command to verify that all required fields, columns, and sprints exist and are correctly configured before running automation.

## 12. Dynamic Project Board Selection and User-Friendly Parameters
- Allow users to specify the project board by URL or board number, not just by raw ID.
- Add logic to dynamically resolve the project board ID from a URL or number, making configuration easier and less error-prone.
- Support updating the requirements and script automatically if the board changes.

## 13. Proposed Rule Changes
- Anything moved to the **New, Parked, or Backlog** columns should not have a Sprint assigned.

## 14. Add Issues and PRs assigned to User to the Project (COMPLETED)
- ✅ Anything assigned to a user should be added to the project board, even if it is not in the "New" column.
- Implementation added in May 2025 to fix issue with PRs and assigned items not being properly added to the board.

## 15. Batch Processing for Linked Issues

## 16. Reduce GraphQL Query Complexity

## 17. Additional Caching for Frequently Accessed Data

## 18. Better Documentation of Linked Issue Inheritance (COMPLETED)
- ✅ Fixed issue with linked issues not inheriting properties from PRs that weren't authored by GITHUB_AUTHOR
- ✅ Updated rules.yml to clarify linked issue inheritance rules for status, sprint, and assignments
- ✅ Added tests to verify correct inheritance behavior
- ✅ Improved documentation in rules.yml regarding assignment inheritance for linked issues
- ✅ Enhanced code to transfer PR assignees to linked issues (instead of just PR author)
- Implementation completed in May 2025 to fix issue #76 not being properly moved to Done when PR #78 was merged

---

If you want to work on any of these, create a GitHub issue and reference this file for details.
