# Project Board Sync Test Plan

## Goals
- Create a comprehensive test suite that catches regressions
- Ensure GitHub Actions workflow fails if tests fail
- Provide clear, actionable test failure messages
- Cover core functionality and edge cases

## Test Structure
```
/test
├── rules/                    # Core business logic tests
│   ├── linked-issues.test.js # PR-Issue relationships
│   ├── columns.test.js      # Column assignments
│   ├── sprints.test.js      # Sprint management
│   └── assignees.test.js    # User assignments
├── github/                   # API integration tests
│   ├── api.test.js          # Core API functions
│   └── graphql.test.js      # GraphQL queries
└── helpers/                  # Shared test utilities
    ├── mocks.js             # Common mock objects
    └── setup.js             # Test environment setup
```

## Implementation Phases

### Phase 1: Establish Testing Pattern (Current)
- [x] Set up node:test
- [x] First passing test (linked-issues no-op case)
- [ ] Add PR with linked issue test
- [ ] Create shared mocks
- [ ] Update GitHub workflow

### Phase 2: Core Function Coverage
- [ ] Linked Issues
  - [x] PR with no linked issues
  - [ ] PR with one linked issue
  - [ ] PR closed but not merged
  - [ ] Error handling
- [ ] Column Rules
  - [ ] Basic column assignment
  - [ ] Invalid column handling
- [ ] Sprint Rules
  - [ ] Basic sprint assignment
  - [ ] Sprint transition cases
- [ ] Assignee Rules
  - [ ] Basic assignee sync
  - [ ] Multiple assignees

### Phase 3: Edge Cases & Integration
- [ ] Complex scenarios
  - [ ] Multiple linked items
  - [ ] Cross-repository links
- [ ] Error cases
  - [ ] API failures
  - [ ] Rate limiting
  - [ ] Invalid responses
- [ ] State transitions
  - [ ] PR open → merged
  - [ ] Column changes

### Phase 4: CI Integration
- [ ] GitHub Actions workflow updates
  - [ ] Run tests in CI
  - [ ] Proper error reporting
  - [ ] Test coverage tracking

## Mock Strategy
1. Keep mocks minimal and focused
2. Share common test fixtures
3. Use realistic data shapes
4. Mock only what's necessary

## Success Criteria
1. All core functions have tests
2. CI fails on test failures
3. Clear failure messages
4. Coverage of main functionality
5. Realistic API interaction tests

## Next Steps
1. Add "PR with linked issue" test case
2. Create helpers/mocks.js
3. Update GitHub workflow
4. Continue with column tests
