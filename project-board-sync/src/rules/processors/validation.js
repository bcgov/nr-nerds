/**
 * @fileoverview Shared validation utilities for rule processors
 */

const { StepVerification } = require('../../utils/verification-steps');
const { log } = require('../../utils/log');

class RuleValidation {
  constructor() {
    this.steps = new StepVerification([
      'RULE_CONFIG_LOADED',
      'CONDITIONS_VALIDATED',
      'SKIP_CONDITIONS_VALIDATED'
    ]);

    this.steps.addStepDependencies('CONDITIONS_VALIDATED', ['RULE_CONFIG_LOADED']);
    this.steps.addStepDependencies('SKIP_CONDITIONS_VALIDATED', ['RULE_CONFIG_LOADED']);
  }

  /**
   * Evaluate a simple condition against an item
   */
  validateItemCondition(item, condition, context = {}) {
    const typeMap = {
      'PR': 'PullRequest',
      'Issue': 'Issue'
    };

    try {
      // Type validation
      if (condition.type) {
        const expectedTypes = Array.isArray(condition.type) ? condition.type : [condition.type];
        const expectedItemTypes = expectedTypes.map(t => typeMap[t] || t);
        if (!expectedItemTypes.includes(item.__typename)) {
          return false;
        }
      }

      // Column validation
      if (condition.condition?.startsWith('Column=') || condition.condition?.startsWith('column=')) {
        const expectedColumn = condition.condition.split('=')[1].trim();
        const currentColumn = item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Status')?.name;
        
        if (expectedColumn === 'None') {
          return !currentColumn;
        }
        return currentColumn === expectedColumn;
      }

      // Sprint validation  
      if (condition.condition?.startsWith('sprint=') || condition.condition?.startsWith('Sprint=')) {
        const sprint = item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Sprint')?.name;
        const expectedSprint = condition.condition.split('=')[1].trim();
        return sprint === expectedSprint;
      }

      // Project state validation
      if (condition.condition === 'already_in_project') {
        return item.projectItems?.nodes?.length > 0;
      }

      // User validation
      if (condition.condition === 'author = monitored_user' && context.monitoredUser) {
        return item.author?.login === context.monitoredUser;
      }
      if (condition.condition === 'assignee = monitored_user' && context.monitoredUser) {
        return item.assignees?.nodes?.some(a => a.login === context.monitoredUser);
      }

      // Repository validation
      if (condition.condition === 'repository in monitored_repos' && context.project?.repositories) {
        const repoName = item.repository?.nameWithOwner?.split('/')[1];
        if (!repoName) return false;
        return context.project.repositories.includes(repoName);
      }

      throw new Error(`Unknown condition: ${condition.condition}`);
    } catch (error) {
      log.error(`Error evaluating condition: ${error.message}`);
      return false;
    }
  }

  /**
   * Validate skip conditions
   */
  validateSkipRule(item, skipIf) {
    this.steps.validateStepCompleted('SKIP_CONDITIONS_VALIDATED');

    switch (skipIf) {
      case 'already_in_project':
        return item.projectItems?.nodes?.length > 0;
      case 'Column=Any already set':
        return !!item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Status')?.name;
      case 'Column=Any except New': {
        const column = item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Status')?.name;
        return column && column !== 'New';
      }
      case 'sprint = current':
        return item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Sprint')?.name === 'current';
      case 'sprint != None': {
        const sprint = item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Sprint')?.name;
        return sprint !== null && sprint !== undefined;
      }
      default:
        throw new Error(`Unknown skip condition: ${skipIf}`);
    }
  }
}

module.exports = { RuleValidation };
