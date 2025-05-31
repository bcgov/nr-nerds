const { getLinkedIssues, processLinkedIssues } = require('../src/rules/linked-issues');
const { TEST_CONFIG } = require('../test-config/setup');

describe('Rule Set 4: Linked Issues', () => {
  test('should process linked issues for a PR', async () => {
    const testPR = {
      id: 'test-pr-1',
      __typename: 'PullRequest',
      number: 101,
      repository: { nameWithOwner: 'bcgov/nr-nerds' },
      closingIssuesReferences: {
        nodes: [
          {
            id: 'test-issue-1',
            number: 100,
            repository: { nameWithOwner: 'bcgov/nr-nerds' }
          }
        ]
      },
      author: { login: TEST_CONFIG.monitoredUser }
    };

    const result = await processLinkedIssues(
      testPR, 
      TEST_CONFIG.projectId,
      'Active',
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
      closingIssuesReferences: {
        nodes: []
      },
      author: { login: TEST_CONFIG.monitoredUser }
    };

    const result = await processLinkedIssues(
      testPR, 
      TEST_CONFIG.projectId,
      'Active',
      'Current Sprint'
    );

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
  });
});
