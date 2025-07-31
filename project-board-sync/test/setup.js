/**
 * @fileoverview Test setup and initialization
 * Ensures all tests have proper state tracking and environment setup
 */

const { StateVerifier } = require('../src/utils/state-verifier');

// Initialize state tracking for tests
function setupTestEnvironment() {
    // Mark basic steps as complete for tests in correct dependency order
    StateVerifier.steps.markStepComplete('STATE_TRACKING_INITIALIZED');
    StateVerifier.steps.markStepComplete('VERIFICATION_PROGRESS_SETUP');
    StateVerifier.steps.markStepComplete('TRANSITION_VALIDATOR_CONFIGURED');
    StateVerifier.steps.markStepComplete('RULES_INITIALIZED');
    StateVerifier.steps.markStepComplete('DEPENDENCIES_VERIFIED');
    StateVerifier.steps.markStepComplete('STATE_VALIDATED');
    StateVerifier.steps.markStepComplete('STATE_VERIFIED');
    
    // Ensure environment variables are set for tests
    if (!process.env.GITHUB_AUTHOR) {
        process.env.GITHUB_AUTHOR = 'DerekRoberts';
    }
    if (!process.env.GITHUB_TOKEN) {
        process.env.GITHUB_TOKEN = 'test-token';
    }
}

// Export for use in test files
module.exports = { setupTestEnvironment }; 