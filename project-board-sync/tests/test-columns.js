const { processColumns } = require('../src/rules/columns');
const { getRecentItems } = require('../src/github/api');
const { log } = require('../src/utils/log');

// Test configuration - directly from requirements.md
const TEST_CONFIG = {
  org: 'bcgov',
  repos: ['nr-nerds'],
  monitoredUser: process.env.GITHUB_AUTHOR,
  projectId: 'PVT_kwDOAA37OM4AFuzg'
};

async function testColumns() {
  console.log('\n=== Testing Rule Set 2: Column Assignment ===\n');

  try {
    // Get items to test with
    const items = await getRecentItems(
      TEST_CONFIG.org,
      TEST_CONFIG.repos,
      TEST_CONFIG.monitoredUser
    );

    const result = await processColumns({
      ...TEST_CONFIG,
      items
    });

    console.log('\nResults:');
    console.log(`- Items processed: ${result.processedItems.length}`);
    console.log(`- Items skipped: ${result.skippedItems.length}`);

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
