/**
 * @fileoverview Shared verification step tracking and validation
 * @see /src/index.js for project conventions and architecture
 * 
 * Module Conventions:
 * - Step completion is tracked via Set
 * - Steps can have dependencies
 * - All step validations are logged
 * - Validation failures throw errors
 */

const { Logger } = require('./log');

class StepVerification {
  constructor(requiredSteps = []) {
    this.completedSteps = new Set();
    this.requiredSteps = requiredSteps;
    this.stepDependencies = new Map();
    this.log = new Logger();
  }

  /**
   * Add a dependency between steps
   * @param {string} step - The step that depends on others
   * @param {string[]} dependencies - The steps this one depends on
   */
  addStepDependencies(step, dependencies) {
    this.stepDependencies.set(step, dependencies);
  }

  /**
   * Mark a verification step as completed
   * @param {string} step - The step identifier
   */
  markStepComplete(step) {
    // Validate dependencies first
    const dependencies = this.stepDependencies.get(step) || [];
    for (const dep of dependencies) {
      if (!this.completedSteps.has(dep)) {
        throw new Error(`Cannot complete ${step} - dependency ${dep} not completed`);
      }
    }

    this.completedSteps.add(step);
    this.log.debug(`Completed verification step: ${step}`);
  }

  /**
   * Validate that a required step has been completed
   * @param {string} step - The step identifier to check
   * @throws {Error} If the step has not been completed
   */
  validateStepCompleted(step) {
    if (!this.completedSteps.has(step)) {
      throw new Error(`Required step not completed: ${step}`);
    }
  }

  /**
   * Check if a step has been completed (non-throwing version)
   * @param {string} step - The step identifier to check
   * @returns {boolean} True if the step has been completed
   */
  isStepCompleted(step) {
    return this.completedSteps.has(step);
  }

  /**
   * Check if all required steps are completed
   * @returns {boolean} True if all required steps are complete
   */
  areAllStepsCompleted() {
    return this.requiredSteps.every(step => this.completedSteps.has(step));
  }

  /**
   * Get list of incomplete steps
   * @returns {string[]} List of steps not yet completed
   */
  getIncompleteSteps() {
    return this.requiredSteps.filter(step => !this.completedSteps.has(step));
  }

  /**
   * Get list of all completed steps in order of completion
   * @returns {string[]} List of completed steps
   */
  getCompletedSteps() {
    return [...this.completedSteps];
  }

  /**
   * Print verification step status
   */
  printStepStatus() {
    this.log.info('\nVerification Step Status:', true);
    this.log.info('========================', true);
    
    this.requiredSteps.forEach(step => {
      const completed = this.completedSteps.has(step);
      const dependencies = this.stepDependencies.get(step);
      this.log.info(`${completed ? '✓' : '✗'} ${step}`, true);
      if (dependencies?.length > 0) {
        this.log.info(`  Dependencies: ${dependencies.join(', ')}`, true);
      }
    });
  }
}

module.exports = { StepVerification };
