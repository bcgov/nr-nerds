const { getLinkedIssues, processLinkedIssues } = require('../src/rules/linked-issues');
const { TEST_CONFIG } = require('../test-config/setup');
const { COLUMNS } = require('../test-config/constants');
const { resetMocks, __setMockLinkedIssues } = require('../test-config/mocks/github-api');

describe('Rule Set 4: Linked Issues', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('should process linked issues for a PR', async () => {
    const testIssue = {
      id: 'test-issue-1',
      __typename: 'Issue',
      number: 100,
      repository: { nameWithOwner: 'bcgov/nr-nerds' },
      author: { login: 'tester' },
      assignees: { nodes: [] }
    };

    __setMockLinkedIssues('bcgov', 'nr-nerds', 101, [testIssue]);

    const testPR = {
      id: 'test-pr-1',
      __typename: 'PullRequest',
      number: 101,
      repository: { nameWithOwner: 'bcgov/nr-nerds' },
      author: { login: 'tester' },
      assignees: { nodes: [{ login: 'assignee1' }] },
      closingIssuesReferences: {
        nodes: [testIssue]
      }
    };

    const result = await processLinkedIssues(
      testPR, 
      TEST_CONFIG.projectId,
      COLUMNS.ACTIVE,
      'Current Sprint'
    );

    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
  });

  test('should handle PR without linked issues', async () => {
    const testPR = {
      id: 'test-pr-2',
      __typename: 'PullRequest',
      number: 102,
      repository: { nameWithOwner: 'bcgov/nr-nerds' },
      author: { login: 'tester' },
      assignees: { nodes: [] },
      closingIssuesReferences: {
        nodes: []
      }
    };

    const result = await processLinkedIssues(
      testPR,
      TEST_CONFIG.projectId,
      COLUMNS.ACTIVE,
      'Current Sprint'
    );

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
  });
});
