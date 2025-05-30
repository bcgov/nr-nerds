# Project Board Sync Rules

This document describes the five rule sets that govern how items (PRs and Issues) are managed in the project board.

## 1. Board Addition Rules

These rules determine which items are added to the project board:

| Item Type | Trigger Condition             | Action               | Skip Condition     |
|-----------|-------------------------------|----------------------|--------------------|
| PR        | Authored by monitored user    | Add to project board | Already in project |
| PR        | Assigned to monitored user    | Add to project board | Already in project |
| PR        | Found in monitored repository | Add to project board | Already in project |
| Issue     | Found in monitored repository | Add to project board | Already in project |

## 2. Column Rules

These rules determine which column an item is placed in:

| Item Type | Trigger Condition | Action        | Skip Condition         |
|-----------|-------------------|---------------|------------------------|
| PR        | Column=None       | Column=Active | Column=Any already set |
| Issue     | Column=None       | Column=New    | Column=Any already set |

## 3. Sprint Assignment Rules

These rules determine which sprint an item belongs to:

| Item Type | Trigger Condition   | Action         | Skip Condition             |
|-----------|---------------------|----------------|----------------------------|
| PR, Issue | Column=Next, Active | Sprint=current | Sprint=current already set |
| PR, Issue | Column=Done         | Sprint=current | Sprint=any already set     |

## 4. Linked Issue Rules

When a PR is linked to issues using closing keywords (e.g., "fixes #123"), those issues should inherit:

1. The same column as the PR
2. The same sprint as the PR
3. The same assignee(s) as the PR

This ensures that related issues are properly tracked alongside their fixing PRs.

## 5. Assignee Rules

These rules govern how assignees are managed:

1. PRs should have at least one assignee
2. If no assignee is set, assign to PR author
3. Linked issues inherit assignees from their linked PRs

## Implementation Notes

- The rules are processed in order (1-5) to ensure consistent state
- All operations are idempotent - running multiple times produces the same result
- Errors during processing of one item don't stop processing of others
- Changes are logged for audit purposes
