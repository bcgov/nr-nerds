const { processColumnAssignment } = require('../src/rules/columns');
const { TEST_CONFIG } = require('./setup');
const Logger = require('../src/utils/log').Logger;
const log = new Logger();

async function testColumns() {
  console.log('\n=== Testing Rule Set 2: Column Assignment ===\n');

  try {
    // Test PR with no column
    const testPR = {
      id: 'test-pr-1',
      __typename: 'PullRequest',
      projectItemId: 'test-project-item-1',
    };

    const prResult = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
    console.log('PR column assignment result:', prResult);

    // Test Issue with no column
    const testIssue = {
      id: 'test-issue-1',
      __typename: 'Issue',
      projectItemId: 'test-project-item-2',
    };

    const issueResult = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
    console.log('Issue column assignment result:', issueResult);

    console.log('\nResults:');
    console.log(`- PR Test: ${prResult.changed ? 'Changed' : 'Skipped'} - ${prResult.reason}`);
    console.log(`- Issue Test: ${issueResult.changed ? 'Changed' : 'Skipped'} - ${issueResult.reason}`);

    log.printSummary();
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Run test if this file is run directly
if (require.main === module) {
  testColumns();
}

module.exports = {
  testColumns
};
