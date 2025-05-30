const { processAssignees, getItemAssignees } = require('../src/rules/assignees');
const { TEST_CONFIG } = require('./setup');
const { log } = require('../src/utils/log');

async function testAssigneeRules() {
  console.log('\n=== Testing Rule Set 5: Assignee Rules ===\n');

  try {
    // Test PR with no assignees
    const testPR = {
      __typename: 'PullRequest',
      id: 'test-pr-1',
      number: 123,
      repository: { 
        nameWithOwner: 'bcgov/nr-nerds'
      },
      author: { login: TEST_CONFIG.monitoredUser },
      assignees: { nodes: [] }
    };

    const projectId = TEST_CONFIG.projectId;
    const itemId = 'test-item-1';

    // Process assignees
    const result = await processAssignees(testPR, projectId, itemId);
    
    console.log('\nResults:');
    console.log('- Changed:', result.changed);
    console.log('- Assignees:', result.assignees);
    console.log('- Reason:', result.reason);

    // Verify current assignees
    const currentAssignees = await getItemAssignees(projectId, itemId);
    console.log('- Current assignees:', currentAssignees);

    log.printSummary();
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Run test if this file is run directly
if (require.main === module) {
  testAssigneeRules();
}

module.exports = {
  testAssigneeRules
};

const { processAssignees } = require('../src/rules/assignees');
const { TEST_CONFIG } = require('../test-config/setup');
const { Logger } = require('../src/utils/log');

describe('Rule Set 5: Assignees', () => {
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

  test('should handle PR without assignees', async () => {
    const testPR = {
      id: 'test-pr-2',
      __typename: 'PullRequest',
      number: 102,
      repository: { nameWithOwner: 'bcgov/nr-nerds' },
      assignees: {
        nodes: []
      }
    };

    const result = await processAssignees(testPR, TEST_CONFIG.projectId, 'test-project-item-2');
    expect(result.changed).toBe(true);
    expect(result.assignees).toHaveLength(0);
  });
});
