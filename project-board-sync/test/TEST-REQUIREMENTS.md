# Test Requirements

This document maps tests to specific rules in requirements.md to ensure complete coverage and prevent regressions.

## Rule Coverage Map

### 1. Board Addition Rules
| Rule | Test File | Test Name | Validated Fields |
|------|-----------|-----------|-----------------|
| PR authored by monitored user | workflow.test.js | monitored user PR is added with correct column and author as assignee | PR added, author field preserved |
| PR in monitored repo | workflow.test.js | full workflow tracks state changes correctly | PR added, repo field checked |

### 2. Column Rules  
| Rule | Test File | Test Name | Validated Fields |
|------|-----------|-----------|-----------------|
| PR Column=None -> Active | workflow.test.js | monitored user PR is added with correct column and author as assignee | New PR gets Active column |
| PR Column=New -> Active | workflow.test.js | full workflow tracks state changes correctly | Existing New PR moves to Active |

### 5. Assignee Rules
| Rule | Test File | Test Name | Validated Fields |
|------|-----------|-----------|-----------------|
| Author=monitored user -> Add as assignee | workflow.test.js | monitored user PR is added with correct column and author as assignee | Author assigned when monitored user |

## Verification Steps

For each test that validates a rule:
1. Verify the rule exists in requirements.md
2. Test both positive and negative cases
3. Verify state changes are tracked and logged
4. Run with verbose logging enabled
5. Validate all required fields are preserved between steps
6. Test rule interactions and ordering

## Adding New Tests

When adding a test:
1. Update this document to show rule coverage
2. Include test name and validated fields
3. Reference the specific rule being tested
4. Verify no duplicate coverage
5. Test boundary conditions

## Rule Verification

Every test must:
1. Reference a specific rule from requirements.md
2. Validate exact field values, not just presence
3. Track state changes through StateVerifier
4. Include both success and error cases
5. Log all state transitions
