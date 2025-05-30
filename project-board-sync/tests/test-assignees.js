const { processAssignees, getItemAssignees } = require('../src/rules/assignees');
const { TEST_CONFIG } = require('../test-config/setup');
const { Logger } = require('../src/utils/log');
const { resetMocks, mockData } = require('../test-config/mocks/github-api');

describe('Rule Set 5: Assignees', () => {
  beforeEach(() => {
    resetMocks();
    // Set up mock project items without any assignees initially
    mockData.projectItems.set('test-project-item-1', {
      id: 'test-project-item-1',
      content: { id: 'test-pr-1' }
    });
    // Don't set any assignees initially, they should be set by the test

    mockData.projectItems.set('test-project-item-2', {
      id: 'test-project-item-2',
      content: { id: 'test-pr-2' }
    });
  });

  test('should sync PR assignees with project item', async () => {
    const testPR = {
      id: 'test-pr-1',
      __typename: 'PullRequest',
      number: 101,
      repository: { nameWithOwner: 'bcgov/nr-nerds' },
      assignees: {
        nodes: [
          { login: TEST_CONFIG.monitoredUser }
        ]
      }
    };

    const result = await processAssignees(testPR, TEST_CONFIG.projectId, 'test-project-item-1');
    expect(result.changed).toBe(true);
    expect(result.assignees).toContain(TEST_CONFIG.monitoredUser);
  });

  test('should handle PR without assignees by assigning PR author', async () => {
    const testPR = {
      id: 'test-pr-2',
      __typename: 'PullRequest',
      number: 102,
      repository: { nameWithOwner: 'bcgov/nr-nerds' },
      assignees: {
        nodes: []
      },
      author: {
        login: TEST_CONFIG.monitoredUser
      }
    };

    const result = await processAssignees(testPR, TEST_CONFIG.projectId, 'test-project-item-2');
    expect(result.changed).toBe(true);
    expect(result.assignees).toEqual([TEST_CONFIG.monitoredUser]);
  });
});
