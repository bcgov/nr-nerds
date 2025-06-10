const { test } = require('node:test');
const assert = require('node:assert/strict');
const { StateTransitionValidator } = require('../src/utils/state-transition-validator');

test('StateTransitionValidator', async (t) => {
  await t.test('validates simple column transitions', async () => {
    const validator = new StateTransitionValidator();
    
    // Complete all required steps in correct order
    validator.steps.markStepComplete('CONFIG_LOADED');
    validator.steps.markStepComplete('DEPENDENCIES_VERIFIED');
    validator.steps.markStepComplete('RULES_VALIDATED');
    validator.steps.markStepComplete('CONDITIONS_DOCUMENTED');
    validator.steps.markStepComplete('TRANSITION_VALIDATED');
    
    // Set up rules
    validator.addColumnTransitionRule('Backlog', 'Active', []);
    validator.addColumnTransitionRule('Active', 'Review', ['item.hasReviewers']);
    validator.addColumnTransitionRule('Review', ['Done', 'Blocked'], []);
    
    // Test valid transitions
    const validResult = validator.validateColumnTransition('Backlog', 'Active');
    assert.equal(validResult.valid, true, 'Should allow valid transition');
    
    // Test invalid transitions
    const invalidResult = validator.validateColumnTransition('Backlog', 'Done');
    assert.equal(invalidResult.valid, false, 'Should reject invalid transition');
    assert.equal(
      invalidResult.reason,
      'Transition from "Backlog" to "Done" is not allowed',
      'Should explain rejection reason'
    );
    
    // Test condition evaluation
    const noReviewersResult = validator.validateColumnTransition(
      'Active',
      'Review',
      { item: { hasReviewers: false } }
    );
    assert.equal(noReviewersResult.valid, false, 'Should reject when conditions not met');
    
    const hasReviewersResult = validator.validateColumnTransition(
      'Active',
      'Review',
      { item: { hasReviewers: true } }
    );
    assert.equal(hasReviewersResult.valid, true, 'Should allow when conditions met');
  });

  await t.test('validates complete state transitions', async () => {
    const validator = new StateTransitionValidator();
    
    // Complete all required steps in correct order
    validator.steps.markStepComplete('CONFIG_LOADED');
    validator.steps.markStepComplete('DEPENDENCIES_VERIFIED');
    validator.steps.markStepComplete('RULES_VALIDATED');
    validator.steps.markStepComplete('CONDITIONS_DOCUMENTED');
    validator.steps.markStepComplete('TRANSITION_VALIDATED');
    
    // Set up column rules
    validator.addColumnTransitionRule('Backlog', 'Active', []);
    
    // Test item
    const item = {
      type: 'PullRequest',
      number: 123,
      projectItemId: 'item_123'
    };
    
    // Test valid complete state change
    const validResult = validator.validateStateTransition(
      item,
      {
        column: 'Backlog',
        assignees: ['user1']
      },
      {
        column: 'Active',
        assignees: ['user1', 'user2']  // Adding assignee is allowed
      }
    );
    assert.equal(validResult.valid, true, 'Should allow valid state transition');
    
    // Test invalid complete state change
    const invalidResult = validator.validateStateTransition(
      item,
      {
        column: 'Backlog',
        assignees: ['user1', 'user2']
      },
      {
        column: 'Active',
        assignees: ['user1']  // Removing assignee without explicit removal action
      }
    );
    assert.equal(invalidResult.valid, false, 'Should reject invalid state transition');
    assert(
      invalidResult.errors[0].includes('Cannot remove assignees'),
      'Should explain assignee removal error'
    );
    
    // Test assignee limit
    const tooManyAssignees = validator.validateStateTransition(
      item,
      {
        column: 'Active',
        assignees: ['user1']
      },
      {
        column: 'Active',
        assignees: ['user1', 'user2', 'user3', 'user4', 'user5', 'user6']
      },
      { maxAssignees: 5 }
    );
    assert.equal(tooManyAssignees.valid, false, 'Should reject too many assignees');
    assert(
      tooManyAssignees.errors[0].includes('Maximum of 5 assignees allowed'),
      'Should explain assignee limit error'
    );
  });
});
