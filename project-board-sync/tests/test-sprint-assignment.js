const { processSprintAssignment } = require('../src/rules/sprints');
const { TEST_CONFIG } = require('./setup');
const Logger = require('../src/utils/log').Logger;
const log = new Logger();

async function testSprintAssignment() {
  console.log('\n=== Testing Rule Set 3: Sprint Assignment ===\n');

  try {
    // Test for items in Next/Active columns
    const activeItem = {
      id: 'test-item-1',
      projectItemId: 'test-project-item-1',
      column: 'Active',
      currentSprint: null
    };

    const result1 = await processSprintAssignment(activeItem, TEST_CONFIG.projectId);
    console.log('Active item test result:', result1);

    // Test for items in Done column
    const doneItem = {
      id: 'test-item-2',
      projectItemId: 'test-project-item-2',
      column: 'Done',
      currentSprint: 'old-sprint'
    };

    const result2 = await processSprintAssignment(doneItem, TEST_CONFIG.projectId);
    console.log('Done item test result:', result2);

    log.printSummary();
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

testSprintAssignment();
