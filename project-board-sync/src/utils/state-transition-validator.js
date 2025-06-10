/**
 * @fileoverview State transition validation for project board changes
 * @see /src/index.js for project conventions and architecture
 * 
 * Module Conventions:
 * - Case-insensitive string comparison for state values
 * - State transitions are defined through explicit rules
 * - All validations provide detailed error messages
 * - Changes are tracked for state verification
 * 
 * Documentation Update Guidelines:
 * Update this documentation when:
 * - Adding new validation rules or conditions
 * - Changing state comparison behavior
 * - Modifying error message formats
 * - Adding new state tracking features
 * 
 * Maintain Stability:
 * - Document all condition formats in evaluateCondition()
 * - Keep error messages consistent with examples
 * - Update test cases for new validations
 * - Preserve case-insensitive behavior
 * 
 * Step Verification Checklist:
 * 1. Configuration Loading
 *    - ✓ rules.yml loaded and validated
 *    - ✓ column transitions defined
 *    - ✓ conditions documented
 * 
 * 2. State Change Validation
 *    - ✓ normalize column names
 *    - ✓ verify transition rules exist
 *    - ✓ evaluate conditions
 *    - ✓ track changes
 * 
 * 3. Error Handling
 *    - ✓ fail fast on invalid config
 *    - ✓ include error context
 *    - ✓ log state changes
 *    - ✓ track validation failures
 */

const { log } = require('./log');
const { StateChangeTracker } = require('./state-changes');
const { StepVerification } = require('./verification-steps');

class StateTransitionValidator {
  constructor() {
    this.tracker = new StateChangeTracker();
    this.columnRules = new Map();
    
    // Initialize verification steps with enhanced dependencies
    this.steps = new StepVerification([
      'CONFIG_LOADED',
      'RULES_VALIDATED',
      'CONDITIONS_DOCUMENTED',
      'DEPENDENCIES_VERIFIED',
      'TRANSITION_VALIDATED'
    ]);
    
    // Set up step dependencies with enhanced validation
    this.steps.addStepDependencies('RULES_VALIDATED', ['CONFIG_LOADED', 'DEPENDENCIES_VERIFIED']);
    this.steps.addStepDependencies('CONDITIONS_DOCUMENTED', ['CONFIG_LOADED']);
    this.steps.addStepDependencies('TRANSITION_VALIDATED', ['RULES_VALIDATED', 'CONDITIONS_DOCUMENTED']);

    // Initialize error tracking
    this.validationErrors = new Map();
  }

  /**
   * Add a rule for valid column transitions with enhanced validation
   */
  addColumnTransitionRule(from, to, conditions = []) {
    try {
      // Validate configuration loading step
      this.steps.validateStepCompleted('CONFIG_LOADED');
      
      const sources = Array.isArray(from) ? from : [from];
      for (const source of sources) {
        const sourceLower = source.toLowerCase();
        if (!this.columnRules.has(sourceLower)) {
          this.columnRules.set(sourceLower, []);
        }
        
        // Validate and document conditions
        const validatedConditions = conditions.map(condition => {
          if (!this.evaluateCondition(condition, {})) {
            throw new Error(`Invalid condition format: ${condition}`);
          }
          return {
            expression: condition,
            description: this.getConditionDescription(condition),
            dependencies: this.getConditionDependencies(condition)
          };
        });
        
        this.columnRules.get(sourceLower).push({
          to,
          conditions: validatedConditions,
          addedAt: new Date()
        });
      }
      
      this.steps.markStepComplete('RULES_VALIDATED');
    } catch (error) {
      this.validationErrors.set(`${from}->${to}`, error);
      throw error;
    }
  }

  /**
   * Check if a column transition is valid with enhanced error reporting
   */
  validateColumnTransition(from, to, context = {}) {
    try {
      this.steps.validateStepCompleted('RULES_VALIDATED');

      // Allow initial column setting
      if (!from || from === 'None') {
        return { valid: true };
      }

      // Normalize column names for comparison
      const normalizedFrom = from.toLowerCase();
      const normalizedTo = to.toLowerCase();

      // No change
      if (normalizedFrom === normalizedTo) {
        return { valid: true };
      }

      // Check if source column has any rules
      const rules = this.columnRules.get(normalizedFrom);
      if (!rules) {
        return {
          valid: false,
          reason: `No transitions defined from column "${from}"`,
          recovery: `Add a transition rule from "${from}" to allow this change`
        };
      }

      // Find matching rule with enhanced validation
      const matchingRule = rules.find(rule => {
        const ruleToLower = Array.isArray(rule.to) ? rule.to.map(t => t.toLowerCase()) : rule.to.toLowerCase();
        if (Array.isArray(ruleToLower)) {
          return ruleToLower.includes(normalizedTo);
        }
        return ruleToLower === normalizedTo;
      });

      if (!matchingRule) {
        return {
          valid: false,
          reason: `Transition from "${from}" to "${to}" is not allowed`,
          allowedTransitions: rules.map(r => r.to),
          recovery: `Consider one of the allowed transitions: ${rules.map(r => r.to).join(', ')}`
        };
      }

      // Check conditions if any with detailed failure tracking
      if (matchingRule.conditions.length > 0) {
        const failedConditions = matchingRule.conditions.filter(condition => {
          try {
            return !this.evaluateCondition(condition.expression, context);
          } catch (error) {
            log.error(`Error evaluating condition "${condition.expression}": ${error.message}`);
            return true;
          }
        });

        if (failedConditions.length > 0) {
          return {
            valid: false,
            reason: `Failed conditions for transition:`,
            details: failedConditions.map(c => ({
              condition: c.expression,
              description: c.description,
              dependencies: c.dependencies
            })),
            recovery: `Ensure all conditions are met before attempting transition`
          };
        }
      }

      return { valid: true };
    } catch (error) {
      log.error(`Validation error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get human readable description of a condition
   */
  getConditionDescription(condition) {
    const descriptions = {
      'item.hasReviewers': 'Pull request must have reviewers assigned',
      'item.hasAssignees': 'Issue/PR must have assignees',
      'item.isMerged': 'Pull request must be merged',
      'item.isApproved': 'Pull request must be approved by reviewers'
    };
    return descriptions[condition] || `Condition: ${condition}`;
  }

  /**
   * Get dependencies required for a condition
   */
  getConditionDependencies(condition) {
    const dependencies = {
      'item.hasReviewers': ['reviewer-access'],
      'item.hasAssignees': ['write-access'],
      'item.isMerged': ['repo-access', 'merge-access'],
      'item.isApproved': ['reviewer-access', 'approval-access']
    };
    return dependencies[condition] || [];
  }

  /**
   * Validate a complete state transition with enhanced error tracking
   */
  validateStateTransition(item, currentState, newState, context = {}) {
    // Verify required steps are complete
    this.steps.validateStepCompleted('RULES_VALIDATED');
    
    const errors = [];
    const validationContext = {
      startTime: Date.now(),
      item,
      changes: []
    };

    try {
      // Check column transition if changing
      if (newState.column && newState.column !== currentState.column) {
        const result = this.validateColumnTransition(
          currentState.column,
          newState.column,
          { ...context, item }
        );
        if (!result.valid) {
          errors.push({
            type: 'column',
            message: result.reason,
            details: result.details,
            recovery: result.recovery
          });
        }
      }

      // Validate assignee changes with enhanced tracking
      if (newState.assignees) {
        const currentSet = new Set(currentState.assignees || []);
        const newSet = new Set(newState.assignees);
        
        // Check for invalid removals
        const removedAssignees = Array.from(currentSet).filter(a => !newSet.has(a));
        if (removedAssignees.length > 0) {
          errors.push({
            type: 'assignees',
            message: `Cannot remove assignees "${removedAssignees.join(', ')}" without explicit removal action`,
            recovery: 'Use explicit assignee removal operation instead of direct state change'
          });
        }

        // Check maximum assignees (if configured)
        if (context.maxAssignees && newSet.size > context.maxAssignees) {
          errors.push({
            type: 'assignees',
            message: `Maximum of ${context.maxAssignees} assignees allowed`,
            current: newSet.size,
            max: context.maxAssignees,
            recovery: `Remove ${newSet.size - context.maxAssignees} assignee(s)`
          });
        }
      }

      // Track state changes
      ['column', 'sprint', 'assignees'].forEach(aspect => {
        if (newState[aspect] !== undefined) {
          validationContext.changes.push({
            type: aspect,
            from: currentState[aspect],
            to: newState[aspect],
            timestamp: Date.now(),
            valid: !errors.find(e => e.type === aspect)
          });
        }
      });

      return {
        valid: errors.length === 0,
        errors: errors.map(e => `${e.message}${e.recovery ? `\nRecovery: ${e.recovery}` : ''}`),
        context: validationContext
      };
    } catch (error) {
      // Track validation failure
      this.tracker.recordError(item, 'State Transition', error, validationContext);
      throw error;
    }
  }

  /**
   * Print validation statistics and error summary
   */
  printStats() {
    this.tracker.printSummary();
    if (this.validationErrors.size > 0) {
      log.info('\nValidation Errors:', true);
      this.validationErrors.forEach((error, transition) => {
        log.error(`${transition}: ${error.message}`);
      });
    }
  }
}

module.exports = { StateTransitionValidator };
