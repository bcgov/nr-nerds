# Contributing Guidelines

## AI Tool Instructions
<!-- AI-TOOLS-START -->
When working with this repository:
1. Read this CONTRIBUTING.md file first
2. Follow all guidelines specified here
3. Do not modify files in `src/` when working on tests - this ensures test fixes don't accidentally change implementation behavior
4. Use the Change Proposal Format below to plan changes
5. Proceed with changes when ALL verification steps pass
6. Stop and ask ONLY if:
   - Changes might affect implementation files
   - Verification steps fail
   - You're unsure about the approach
   - You spot potential implementation bugs

Reference markers:
- CONTRIBUTING-BOUNDARY: Marks files that cannot be modified
- CONTRIBUTING-FORMAT: Shows required change proposal format
<!-- AI-TOOLS-END -->

## Code Formatting Rules
<!-- CONTRIBUTING-FORMAT -->
When suggesting code changes:
1. Use Markdown code blocks with 4 backticks for code snippets
2. Include language identifier after backticks
3. Add filepath comment at the start: `// filepath: /path/to/file`
4. Use `// ...existing code...` to show unchanged sections
5. Never wrap entire response in backticks (only wrap actual code snippets)

Examples:

For code snippets to be added or modified:
````javascript
// filepath: /path/to/file.js
// ...existing code...
const newCode = true;
// ...existing code...
````

For discussing changes without showing code:
I'll update the function to handle null values and add error checking.

For showing multiple files:
````javascript
// filepath: /path/to/file1.js
function example() {
  return true;
}
````

````javascript
// filepath: /path/to/file2.js
const result = example();
````
<!-- CONTRIBUTING-FORMAT -->

## Test Changes Process
<!-- CONTRIBUTING-BOUNDARY -->
Protected files (never modify when fixing tests):
- All files in `src/`
- `config/rules.yml`

Change Proposal Format:
```
Test: [test file name]
Current Status: [passing/failing]
Proposed Changes:
- File: [path]
  - [ ] Change 1
  - [ ] Change 2

Verification:
- [ ] No changes to src/ files
- [ ] No changes to requirements.md
- [ ] Changes follow test guidelines
```
<!-- CONTRIBUTING-BOUNDARY -->

## Contribution Types

### Test Changes
- Only modify files in `tests/`
- Never change implementation behavior
- Focus on improving test reliability
- Use appropriate mocking in tests

### Feature Additions
- Follow the Preliminary Steps section.
- Update `config/rules.yml` first if needed
- Add new tests before implementation
- Follow existing patterns in `src/`
- Keep changes focused and minimal

### Refactoring
- Follow the Preliminary Steps section.
- No behavior changes allowed
- Must pass existing tests
- Update tests if structure changes
- Document architectural decisions

### Bug Fixes
- Follow the Preliminary Steps section.
- Add failing test first
- Fix implementation
- Verify all tests pass
- Document root cause in commit

## Testing Standards
- Tests must reference rules.yml for business rules
- Use appropriate mocks instead of test-specific config files
- Mock external dependencies consistently
- Keep test data minimal and focused

## Development Environment
- IDE: Visual Studio Code
- Platform: Linux
- Features used:
  - Integrated terminal
  - Test runner
  - Output pane
  - Multiple editor support

## Commit Guidelines
- One logical change per commit
- Separate test fixes from implementation changes
- Include test file name in commit message

## Pull Request Requirements

### Requirements Compliance Checklist

For any code changes, verify:

1. [ ] Every behavior change maps to a specific rule in config/rules.yml
2. [ ] No implicit behaviors or assumptions added
3. [ ] No rules accidentally changed or removed
4. [ ] When in doubt, quote the relevant rule from config/rules.yml

### Examples

Good PR description:
> "This implements the author assignment rule from config/rules.yml:
> ```yaml
> - name: Author Assignment
>   description: Add PR author as assignee
>   trigger: item.type === 'PullRequest' && item.author === monitored.user
>   action: add_assignee
>   value: item.author
> ```
> The changes ensure author is added as assignee when they are the monitored user."

Bad PR description:
> "Fixed how assignees work and improved column handling"
