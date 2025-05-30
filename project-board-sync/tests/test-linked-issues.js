const { getLinkedIssues, processLinkedIssues } = require('../src/rules/linked-issues');
const { TEST_CONFIG } = require('./setup');
const { log } = require('../src/utils/log');

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
