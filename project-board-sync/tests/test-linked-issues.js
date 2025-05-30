const { getLinkedIssues, processLinkedIssues } = require('../src/rules/linked-issues');
const { TEST_CONFIG } = require('./setup');
const { Logger } = require('../src/utils/log');
const log = new Logger();

async function testLinkedIssues() {
  console.log('\n=== Testing Rule Set 4: Linked Issue Rules ===\n');

  try {
    // Test PR with linked issues
    const testPR = {
      __typename: 'PullRequest',
      id: 'test-pr-1',
      number: 123,
      repository: { 
        nameWithOwner: 'bcgov/nr-nerds'
      },
      author: { login: TEST_CONFIG.monitoredUser }
    };

    const projectId = TEST_CONFIG.projectId;
    const currentColumn = 'Active';
    const currentSprintId = 'sprint-1';

    // Process linked issues
    const result = await processLinkedIssues(
      testPR,
      projectId,
      currentColumn,
      currentSprintId
    );

    console.log('\nResults:');
    console.log('- Processed:', result.processed);
    console.log('- Errors:', result.errors);

    // Get and verify linked issues
    const linkedIssues = await getLinkedIssues(
      'bcgov',
      'nr-nerds',
      testPR.number
    );
    console.log('- Found linked issues:', linkedIssues.length);

    log.printSummary();
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Run test if this file is run directly
if (require.main === module) {
  testLinkedIssues();
}

module.exports = {
  testLinkedIssues
};

const { processLinkedIssues } = require('../src/rules/linked-issues');
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
      }
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
      }
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
