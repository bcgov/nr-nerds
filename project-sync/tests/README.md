# Project Sync Tests

This directory contains test scripts for the GitHub Projects v2 sync automation.

## Test Files

### direct-test.js
A simple script to test directly adding a specific issue to the project board. Used for verifying the GitHub API integration works correctly.

### fetch-specific-issue.js
A utility script to fetch a specific issue (e.g., nr-forest-client #1603) and add it to the project board. Useful for manual testing.

### test-assignment.js
Tests the user assignment functionality by attempting to assign a user to a specific issue or PR.

### test-sprint-assignment.js
Tests the sprint assignment logic for various scenarios, especially for the "Done" column items. This test is also run as part of the GitHub Actions workflow before deploying changes.

### test-preflight-checks.js
Runs only the preflight validation checks from the main project-sync.js script to verify that:
- Environment variables are properly set
- GitHub API connectivity is working
- Sprint assignment logic is correct
- Monitored repositories configuration is valid
- Project configuration is properly set up
- User assignment functions are available and working
- Sprint configuration is valid
- Specific issue handling works correctly

This test is useful for quickly validating the environment and configuration before running the full sync process.

## Running Tests

To run any test, you need to set the `GH_TOKEN` environment variable with a GitHub token that has proper permissions:

```bash
export GH_TOKEN=your_github_token
node tests/test-sprint-assignment.js
```

To run the preflight checks test:

```bash
export GH_TOKEN=your_github_token
node tests/test-preflight-checks.js
```

## Test Results

Tests will output their results directly to the console. All tests will exit with a non-zero code if they fail, making them suitable for integration in CI/CD pipelines.

## Adding to GitHub Actions

The preflight checks can be incorporated into your GitHub Actions workflow by adding the following step:

```yaml
- name: Run preflight validation checks
  env:
    GH_TOKEN: ${{ secrets.GH_TOKEN }}
  run: |
    echo "Running preflight validation checks..."
    node project-sync/tests/test-preflight-checks.js
```
