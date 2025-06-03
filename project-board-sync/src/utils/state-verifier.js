const { log } = require('./log');
const { getItemColumn, isItemInProject } = require('../github/api');
const { getItemSprint } = require('../rules/sprints');
const assigneesModule = require('../rules/assignees');
const { getItemAssignees } = assigneesModule;
const { StateChangeTracker } = require('./state-changes');
const { VerificationProgress } = require('./verification-progress');

class StateVerifier {
  static tracker = new StateChangeTracker();
  static progress = new VerificationProgress();
  static stateMap = new Map();

  static getState(item) {
    const key = `${item.type}#${item.number}`;
    if (!this.stateMap.has(key)) {
      this.stateMap.set(key, {
        inProject: item.projectItems?.nodes?.length > 0,
        projectItemId: item.projectItems?.nodes?.[0]?.id || null
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
          throw new Error(`Item ${item.type} #${item.number} was not added to project`);
        }

        log.info(`✓ ${item.type} #${item.number} verified in project (attempt ${attempt}/3)`);
        return afterState;
      },
      `project addition for ${item.type} #${item.number}`
    );
  }

  static async verifyCompleteState(item, projectId, expectedState) {
    const itemRef = `${item.type}#${item.number}`;
    const totalSteps = Object.keys(expectedState).length;
    this.progress.startOperation('Complete Verification', itemRef, totalSteps);
    
    const beforeState = this.getState(item);

    return this.retryWithTracking(
      item,
      'Complete State Verification',
      async (attempt) => {
        const apiStart = Date.now();
        const currentState = {
          ...beforeState,
          column: (await getItemColumn(projectId, item.projectItemId)) || 'None',
          sprint: (await getItemSprint(projectId, item.projectItemId))?.sprintId || 'None',
          assignees: await getItemAssignees(projectId, item.projectItemId) || []
        };
        
        const afterState = this.updateState(item, currentState);
        this.progress.recordApiTiming('getItemState', Date.now() - apiStart);

        // Verify each attribute
        const mismatches = [];
        if (expectedState.column) {
          const success = afterState.column?.toLowerCase() === expectedState.column.toLowerCase();
          this.progress.recordStep('Complete Verification', itemRef,
            `Verify column: ${expectedState.column}`, success);
          if (!success) {
            mismatches.push(`Column: expected "${expectedState.column}", got "${afterState.column}"`);
          }
        }

        if (expectedState.sprint) {
          const success = afterState.sprint === expectedState.sprint;
          this.progress.recordStep('Complete Verification', itemRef,
            `Verify sprint: ${expectedState.sprint}`, success);
          if (!success) {
            mismatches.push(`Sprint: expected "${expectedState.sprint}", got "${afterState.sprint}"`);
          }
        }

        if (mismatches.length > 0) {
          throw new Error(
            `State verification failed:\n${mismatches.map(m => `  - ${m}`).join('\n')}`
          );
        }

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
    let lastState = {}; // Track the last known state

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Pass the last known state to the operation
        const result = await operation(attempt, lastState);
        return result;
      } catch (error) {
        lastError = error;
        this.tracker.recordError(item, type, error, attempt);

        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          log.info(`
⌛ ${type} verification attempt ${attempt}/${MAX_RETRIES}
   Item: ${item.type} #${item.number}
   Error: ${error.message}
   Retrying in ${delay/1000}s...`);
          await sleep(delay);
        }
      }
    }

    throw new Error(`Failed to verify ${description} after ${MAX_RETRIES} attempts: ${lastError.message}`);
  }

  /**
   * Print all verification reports
   */
  static printReports() {
    if (this.tracker) {
      this.tracker.printSummary();
    }
    if (this.progress) {
      this.progress.printProgressReport();
    }
  }

  /**
   * Print a summary of all state changes
   */
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
