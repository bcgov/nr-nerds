/**
 * @fileoverview Central state verification and management system
 * @see /src/index.js for project conventions and architecture
 * 
 * Module Conventions:
 * - Stateful verification with retry mechanism
 * - Comprehensive state tracking across operations
 * - Progress monitoring for all verifications
 * - Transition validation integration
 * 
 * Documentation Update Guidelines:
 * Update this documentation when:
 * - Adding new verification types
 * - Modifying retry mechanisms
 * - Changing state tracking integration
 * - Adding new validation rules
 * 
 * Maintain Stability:
 * - Keep retry logic consistent
 * - Document state verification flows
 * - Preserve error tracking format
 * - Test all verification paths
 */

const { log } = require('./log');
const { getItemColumn, isItemInProject } = require('../github/api');
const { getItemSprint } = require('../rules/sprints');
const assigneesModule = require('../rules/assignees');
const { getItemAssignees } = assigneesModule;
const { StateChangeTracker } = require('./state-changes');
const { VerificationProgress } = require('./verification-progress');
const { StateTransitionValidator } = require('./state-transition-validator');

class StateVerifier {
  static tracker = new StateChangeTracker();
  static progress = new VerificationProgress();
  static stateMap = new Map();
  static transitionValidator = null;

  static getTransitionValidator() {
    if (!this.transitionValidator) {
      this.transitionValidator = new StateTransitionValidator();
    }
    return this.transitionValidator;
  }

  static initializeTransitionRules(rules) {
    if (!rules.columns) return;

    for (const rule of rules.columns) {
      if (rule.validTransitions) {
        for (const transition of rule.validTransitions) {
          this.getTransitionValidator().addColumnTransitionRule(
            transition.from,
            transition.to,
            transition.conditions
          );
        }
      }
    }
  }

  static getState(item) {
    const key = `${item.type}#${item.number}`;
    if (!this.stateMap.has(key)) {
      this.stateMap.set(key, {
        inProject: item.projectItems?.nodes?.length > 0,
        projectItemId: item.projectItems?.nodes?.[0]?.id || null,
        assignees: [],
        column: 'None',
        sprint: 'None'
      });
    }
    return this.stateMap.get(key);
  }

  static updateState(item, newValues) {
    const key = `${item.type}#${item.number}`;
    const currentState = this.getState(item);
    const updatedState = { ...currentState, ...newValues };
    this.stateMap.set(key, updatedState);
    return updatedState;
  }

  static async verifyAddition(item, projectId) {
    this.tracker.startTracking(item);
    const beforeState = this.getState(item);
    
    return this.retryWithTracking(
      item,
      'Project Addition',
      async (attempt) => {
        // Add exponential backoff delay between retries
        if (attempt > 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          log.info(`Retry ${attempt}: Waiting ${delay}ms before checking project status...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const { isInProject, projectItemId } = await isItemInProject(item.id, projectId);
        const afterState = this.updateState(item, { 
          inProject: true, 
          projectItemId 
        });

        this.tracker.recordChange(
          item,
          'Project Addition',
          beforeState,
          afterState,
          attempt
        );

        if (!isInProject) {
          const error = new Error(`Item ${item.type} #${item.number} was not added to project`);
          error.isRetryable = true; // Mark as retryable for eventual consistency
          throw error;
        }

        log.info(`✓ ${item.type} #${item.number} verified in project (attempt ${attempt}/3)`);
        return afterState;
      },
      `project addition for ${item.type} #${item.number}`
    );
  }

  static async verifyColumn(item, projectId, expectedColumn) {
    const beforeState = this.getState(item);

    // Validate the transition before attempting it
    const validationResult = this.getTransitionValidator().validateColumnTransition(
      beforeState.column,
      expectedColumn,
      { item }
    );

    if (!validationResult.valid) {
      throw new Error(`Invalid column transition: ${validationResult.reason}`);
    }

    return this.retryWithTracking(
      item,
      'Column Verification',
      async (attempt) => {
        const currentColumn = await getItemColumn(projectId, item.projectItemId);
        const afterState = this.updateState(item, { column: currentColumn });

        this.tracker.recordChange(
          item,
          'Column Verification',
          beforeState,
          afterState,
          attempt
        );

        if (currentColumn?.toLowerCase() !== expectedColumn?.toLowerCase()) {
          throw new Error(`Column mismatch for ${item.type} #${item.number}:
Expected: "${expectedColumn}"
Current: "${currentColumn}"`);
        }

        log.info(`✓ Column verified: "${expectedColumn}" (attempt ${attempt}/3)`);
        return afterState;
      },
      `column state for ${item.type} #${item.number}`
    );
  }

  static async verifyAssignees(item, projectId, expectedAssignees) {
    const beforeState = this.getState(item);

    return this.retryWithTracking(
      item,
      'Assignee Verification',
      async (attempt) => {
        // Get assignees from both project board and Issue/PR
        const projectAssignees = await getItemAssignees(projectId, item.projectItemId);
        const itemDetails = await getItemDetails(item.projectItemId);
        
        if (!itemDetails || !itemDetails.content) {
          throw new Error(`Could not get details for item ${item.projectItemId}`);
        }

        // Get Issue/PR assignees via REST API
        const { repository, number } = itemDetails.content;
        const [owner, repo] = repository.nameWithOwner.split('/');
        const issueOrPrData = itemDetails.type === 'PullRequest' 
          ? await octokit.rest.pulls.get({ owner, repo, pull_number: number })
          : await octokit.rest.issues.get({ owner, repo, issue_number: number });
        
        const repoAssignees = issueOrPrData.data.assignees.map(a => a.login);

        // Verify both are in sync
        const afterState = this.updateState(item, { assignees: projectAssignees });
        this.tracker.recordChange(
          item,
          'Assignee Verification',
          beforeState,
          afterState,
          attempt
        );

        // Compare project board assignees with expected
        const missingInProject = expectedAssignees.filter(a => !projectAssignees.includes(a));
        const extraInProject = projectAssignees.filter(a => !expectedAssignees.includes(a));
        
        // Compare Issue/PR assignees with expected
        const missingInRepo = expectedAssignees.filter(a => !repoAssignees.includes(a));
        const extraInRepo = repoAssignees.filter(a => !expectedAssignees.includes(a));          if (missingInProject.length > 0 || extraInProject.length > 0 || 
            missingInRepo.length > 0 || extraInRepo.length > 0) {
          throw new Error(`Assignee mismatch for ${item.type} #${item.number}:
${missingInProject.length > 0 ? `Missing in project board: ${missingInProject.join(', ')}\n` : ''}${extraInProject.length > 0 ? `Extra in project board: ${extraInProject.join(', ')}\n` : ''}${missingInRepo.length > 0 ? `Missing in Issue/PR: ${missingInRepo.join(', ')}\n` : ''}${extraInRepo.length > 0 ? `Extra in Issue/PR: ${extraInRepo.join(', ')}` : ''}`);
        }

        log.info(`✓ Assignees verified for ${item.type} #${item.number} (attempt ${attempt}/3)`);
        return afterState;
      },
      `assignee state for ${item.type} #${item.number}`
    );
  }

  static async verifyCompleteState(item, projectId, expectedState) {
    const itemRef = `${item.type}#${item.number}`;
    const totalSteps = Object.keys(expectedState).length;
    this.progress.startOperation('Complete Verification', itemRef, totalSteps);
    
    const beforeState = this.getState(item);

    // Validate complete state transition
    const validationResult = this.getTransitionValidator().validateStateTransition(
      item,
      beforeState,
      expectedState,
      { maxAssignees: 5 } // Example limit
    );

    if (!validationResult.valid) {
      throw new Error(
        `Invalid state transition:\n${validationResult.errors.map(e => `  - ${e}`).join('\n')}`
      );
    }

    return this.retryWithTracking(
      item,
      'Complete State Verification',
      async (attempt) => {
        // Get current state
        const apiStart = Date.now();
        const currentState = {
          inProject: true,
          projectItemId: item.projectItemId,
          column: await getItemColumn(projectId, item.projectItemId) || 'None',
          sprint: (await getItemSprint(projectId, item.projectItemId))?.sprintId || 'None',
          assignees: await getItemAssignees(projectId, item.projectItemId) || []
        };
        
        const afterState = this.updateState(item, currentState);
        this.progress.recordApiTiming('getItemState', Date.now() - apiStart);

        // Compare all aspects of state
        const mismatches = [];

        // Verify column
        if (expectedState.column && 
            afterState.column?.toLowerCase() !== expectedState.column.toLowerCase()) {
          mismatches.push(`Column: expected "${expectedState.column}", got "${afterState.column}"`);
        }

        // Verify sprint
        if (expectedState.sprint && afterState.sprint !== expectedState.sprint) {
          mismatches.push(`Sprint: expected "${expectedState.sprint}", got "${afterState.sprint}"`);
        }

        // Verify assignees
        if (expectedState.assignees) {
          const missing = expectedState.assignees.filter(a => !afterState.assignees.includes(a));
          const extra = afterState.assignees.filter(a => !expectedState.assignees.includes(a));
          if (missing.length > 0 || extra.length > 0) {
            if (missing.length > 0) mismatches.push(`Missing assignees: ${missing.join(', ')}`);
            if (extra.length > 0) mismatches.push(`Extra assignees: ${extra.join(', ')}`);
          }
        }

        // Record verification steps
        if (expectedState.column) {
          const success = afterState.column?.toLowerCase() === expectedState.column.toLowerCase();
          this.progress.recordStep('Complete Verification', itemRef,
            `Verify column: ${expectedState.column}`, success);
        }
        if (expectedState.sprint) {
          const success = afterState.sprint === expectedState.sprint;
          this.progress.recordStep('Complete Verification', itemRef,
            `Verify sprint: ${expectedState.sprint}`, success);
        }
        if (expectedState.assignees) {
          const missing = expectedState.assignees.filter(a => !afterState.assignees.includes(a));
          const extra = afterState.assignees.filter(a => !expectedState.assignees.includes(a));
          const success = missing.length === 0 && extra.length === 0;
          this.progress.recordStep('Complete Verification', itemRef,
            'Verify assignees', success);
        }

        // If any mismatches found, throw error
        if (mismatches.length > 0) {
          throw new Error(
            `State verification failed:\n${mismatches.map(m => `  - ${m}`).join('\n')}`
          );
        }

        // Record the complete state change
        this.tracker.recordChange(
          item,
          'Complete State Verification',
          beforeState,
          afterState,
          attempt
        );

        log.info(`✓ Complete state verified for ${itemRef} (attempt ${attempt}/3)`);
        return afterState;
      },
      `complete state for ${item.type} #${item.number}`
    );
  }

  static async retryWithTracking(item, type, operation, description) {
    const MAX_RETRIES = 3;
    let lastError;
    let lastState = this.getState(item); // Start with current state

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await operation(attempt, lastState);
        // Update last known state with operation result
        lastState = {
          ...lastState,
          ...(typeof result === 'object' ? result : {})
        };
        return result;
      } catch (error) {
        lastError = error;
        this.tracker.recordError(item, type, error, attempt);

        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          log.info(`
⌛ ${type} verification attempt ${attempt}/${MAX_RETRIES}
   Item: ${item.type} #${item.number}
   Current State: ${JSON.stringify(lastState, null, 2)}
   Error: ${error.message}
   Retrying in ${delay/1000}s...`);
          await sleep(delay);
        }
      }
    }

    throw new Error(`Failed to verify ${description} after ${MAX_RETRIES} attempts: ${lastError.message}`);
  }

  static printReports() {
    if (this.tracker) {
      this.tracker.printSummary();
    }
    if (this.progress) {
      this.progress.printProgressReport();
    }
    if (this.transitionValidator) {
      this.getTransitionValidator().printStats();
    }
  }

  static printChangeSummary() {
    if (this.tracker) {
      this.tracker.printSummary();
    }
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { StateVerifier };
