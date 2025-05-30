const { processItemForProject } = require('../src/rules/add-items');
const { TEST_CONFIG } = require('./setup');
const Logger = require('../src/utils/log').Logger;
const log = new Logger();

async function testAddItems() {
  console.log('\n=== Testing Rule Set 1: Adding Items to Project Board ===\n');

  try {
    // Test item that should be added
    const testPR = {
      id: 'test-pr-1',
      __typename: 'PullRequest',
      repository: { nameWithOwner: 'bcgov/nr-nerds' },
      author: { login: TEST_CONFIG.monitoredUser },
      assignees: { nodes: [] }
    };

    const result = await processItemForProject(testPR, TEST_CONFIG.projectId, {
      monitoredUser: TEST_CONFIG.monitoredUser,
      monitoredRepos: TEST_CONFIG.monitoredRepos,
      processedIds: new Set()
    });

    console.log('\nResults:');
    console.log('- Test PR result:', result);

    log.printSummary();
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Run test if this file is run directly
if (require.main === module) {
  testAddItems();
}

module.exports = {
  testAddItems
};
