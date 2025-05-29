const { processAddItems } = require('../src/rules/add-items');
const { TEST_CONFIG } = require('./setup');
const { log } = require('../src/utils/log');

async function testAddItems() {
  console.log('\n=== Testing Rule Set 1: Adding Items to Project Board ===\n');

  try {
    const result = await processAddItems(TEST_CONFIG);

    console.log('\nResults:');
    console.log(`- Added items: ${result.addedItems.length}`);
    console.log(`- Skipped items: ${result.skippedItems.length}`);

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
