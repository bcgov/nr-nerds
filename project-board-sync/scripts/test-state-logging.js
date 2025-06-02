console.log('Starting script');

const { log } = require('../src/utils/log');
console.log('Logger loaded');

// Test state logging
async function testStateLogging() {
  console.log('Inside testStateLogging');
  const testItem = {
    id: 'TEST_123',
    type: 'Issue',
    number: 123,
    state: 'OPEN'
  };

  // Log initial state with console.log for debugging
  console.log('About to log initial state');
  log.logState(testItem.id, 'Initial', {
    type: testItem.type,
    number: testItem.number,
    state: testItem.state
  });
  console.log('Logged initial state');

  // Simulate a change
  console.log('Changing state...');
  testItem.state = 'CLOSED';
  
  // Log final state
  log.logState(testItem.id, 'Final', {
    type: testItem.type,
    number: testItem.number,
    state: testItem.state
  });

  // Print debug info
  console.log('Debug: Current log state:', log.logs);
  
  // Print summary
  log.printSummary();
  log.printStateSummary();
}

console.log('Starting test...');
Promise.resolve(testStateLogging())
  .then(() => console.log('Test completed'))
  .catch(error => console.error('Test failed:', error));
