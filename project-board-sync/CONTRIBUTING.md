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
- `requirements.md`

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
- Only modify files in `tests/` and `test-config/`
- Never change implementation behavior
- Focus on improving test reliability
- Use shared test configuration where possible

### Feature Additions
- Follow the Preliminary Steps section.
- Update `requirements.md` first if needed
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
- Tests must reference requirements.md for business rules
- Use shared configuration from test-config/
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
