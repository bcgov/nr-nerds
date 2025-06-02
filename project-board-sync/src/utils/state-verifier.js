const { log } = require('./log');
const { getItemColumn, getItemAssignees, isItemInProject } = require('../github/api');
const { getItemSprint } = require('../rules/sprints');
const { StateChangeTracker } = require('./state-changes');

/**
 * Sleep for a specified number of milliseconds
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Try an operation multiple times with exponential backoff
 */
async function retry(operation, description, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        log.info(`Retry attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        log.info(`Waiting ${delay/1000}s before next attempt...`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to verify ${description} after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Verifies that an item's state matches expectations after a change
 */
class StateVerifier {
  static tracker = new StateChangeTracker();

  /**
   * Verify an item was added to the project
   */
  static async verifyAddition(item, projectId) {
    this.tracker.startTracking(item);
    
    return retry(async (attempt) => {
      const { isInProject, projectItemId } = await isItemInProject(item.id, projectId);
      
      this.tracker.recordChange(
        item,
        'Project Addition',
        { inProject: false },
        { inProject: true, projectItemId },
        attempt
      );

      if (!isInProject) {
        throw new Error(`Item ${item.type} #${item.number} was not added to project`);
      }

      log.info(`✓ ${item.type} #${item.number} verified in project (attempt ${attempt}/3)`);
      log.logState(item.id, 'Addition Verified', { inProject: true, projectItemId });
      return projectItemId;
    }, `project addition for ${item.type} #${item.number}`);
  }

  /**
   * Generic retry with detailed error tracking
   */
  static async retryWithTracking(item, type, operation, description) {
    const MAX_RETRIES = 3;
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await operation(attempt);
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
   * Verify an item's column matches expected state with enhanced tracking
   */
  static async verifyColumn(item, projectId, expectedColumn) {
    return this.retryWithTracking(
      item,
      'Column Verification',
      async (attempt) => {
        const currentColumn = await getItemColumn(projectId, item.projectItemId);
        
        this.tracker.recordChange(
          item,
          'Column Assignment',
          { column: currentColumn },
          { column: expectedColumn },
          attempt
        );

        if (currentColumn?.toLowerCase() !== expectedColumn?.toLowerCase()) {
          throw new Error(`
Column mismatch:
Expected: "${expectedColumn}"
Current:  "${currentColumn}"`);
        }

        log.info(`✓ Column verified: "${expectedColumn}" (attempt ${attempt}/3)`);
        return currentColumn;
      },
      `column state for ${item.type} #${item.number}`
    );
  }

  /**
   * Verify an item's sprint matches expected state
   */
  static async verifySprint(item, projectId, expectedSprint) {
    return retry(async () => {
      const { sprintId, sprintTitle } = await getItemSprint(projectId, item.projectItemId);
      if (expectedSprint && sprintId !== expectedSprint) {
        const diff = getDiff(
          { sprint: expectedSprint, title: 'expected' },
          { sprint: sprintId, title: sprintTitle }
        );
        throw new Error(
          `Sprint mismatch for ${item.type} #${item.number}:\n` +
          diff.map(d => `  ${d}`).join('\n')
        );
      }
      log.logState(item.id, 'Sprint Verified', { sprintId, sprintTitle });
      return { sprintId, sprintTitle };
    }, `sprint state for ${item.type} #${item.number}`);
  }

  /**
   * Verify an item's assignees match expected state
   */
  static async verifyAssignees(item, projectId, expectedAssignees) {
    return retry(async () => {
      const currentAssignees = await getItemAssignees(projectId, item.projectItemId);
      const currentSet = new Set(currentAssignees);
      const expectedSet = new Set(expectedAssignees);
      
      const missing = expectedAssignees.filter(a => !currentSet.has(a));
      const extra = currentAssignees.filter(a => !expectedSet.has(a));
      
      if (missing.length > 0 || extra.length > 0) {
        const diff = getDiff(expectedAssignees, currentAssignees);
        throw new Error(
          `Assignee mismatch for ${item.type} #${item.number}:\n` +
          diff.map(d => `  ${d}`).join('\n')
        );
      }
      log.logState(item.id, 'Assignees Verified', { assignees: currentAssignees });
      return currentAssignees;
    }, `assignee state for ${item.type} #${item.number}`);
  }

  /**
   * Verify linked issues are in the correct state
   */
  static async verifyLinkedIssues(item, projectId, linkedIssues, targetColumn, targetSprint) {
    return retry(async (attempt) => {
      const beforeState = { linkedIssuesVerified: false };
      const afterState = { linkedIssuesVerified: true, verifiedIssues: [] };

      for (const linkedIssue of linkedIssues) {
        const issueRef = `Issue #${linkedIssue.number}`;
        log.info(`Verifying linked ${issueRef} state...`);

        // Verify column
        const currentColumn = await getItemColumn(projectId, linkedIssue.projectItemId);
        if (currentColumn?.toLowerCase() !== targetColumn?.toLowerCase()) {
          throw new Error(
            `Column mismatch for linked ${issueRef}:\n` +
            `Expected: "${targetColumn}"\n` +
            `Current: "${currentColumn}"`
          );
        }

        // Verify sprint if specified
        if (targetSprint) {
          const { sprintId } = await getItemSprint(projectId, linkedIssue.projectItemId);
          if (sprintId !== targetSprint) {
            throw new Error(
              `Sprint mismatch for linked ${issueRef}:\n` +
              `Expected: "${targetSprint}"\n` +
              `Current: "${sprintId}"`
            );
          }
        }

        afterState.verifiedIssues.push({
          number: linkedIssue.number,
          column: currentColumn,
          sprint: targetSprint
        });
      }

      this.tracker.recordChange(
        item,
        'Linked Issues Verification',
        beforeState,
        afterState,
        attempt
      );

      log.info(`✓ All ${linkedIssues.length} linked issues verified (attempt ${attempt}/3)`);
      return true;
    }, `linked issues state for ${item.type} #${item.number}`);
  }

  /**
   * Verify the complete state of an item
   */
  static async verifyCompleteState(item, projectId, expectedState) {
    return retry(async (attempt) => {
      const beforeState = { completeStateVerified: false };
      const currentState = {
        column: await getItemColumn(projectId, item.projectItemId),
        sprint: (await getItemSprint(projectId, item.projectItemId))?.sprintId,
        assignees: await getItemAssignees(projectId, item.projectItemId)
      };

      const mismatches = [];
      if (expectedState.column && currentState.column?.toLowerCase() !== expectedState.column.toLowerCase()) {
        mismatches.push(`Column: expected "${expectedState.column}", got "${currentState.column}"`);
      }
      if (expectedState.sprint && currentState.sprint !== expectedState.sprint) {
        mismatches.push(`Sprint: expected "${expectedState.sprint}", got "${currentState.sprint}"`);
      }
      if (expectedState.assignees) {
        const missing = expectedState.assignees.filter(a => !currentState.assignees.includes(a));
        const extra = currentState.assignees.filter(a => !expectedState.assignees.includes(a));
        if (missing.length > 0) mismatches.push(`Missing assignees: ${missing.join(', ')}`);
        if (extra.length > 0) mismatches.push(`Extra assignees: ${extra.join(', ')}`);
      }

      if (mismatches.length > 0) {
        throw new Error(
          `State verification failed for ${item.type} #${item.number}:\n` +
          mismatches.map(m => `  - ${m}`).join('\n')
        );
      }

      this.tracker.recordChange(
        item,
        'Complete State Verification',
        beforeState,
        { completeStateVerified: true, currentState },
        attempt
      );

      log.info(`✓ Complete state verified for ${item.type} #${item.number} (attempt ${attempt}/3)`);
      return currentState;
    }, `complete state for ${item.type} #${item.number}`);
  }

  /**
   * Print a summary of all state changes
   */
  static printChangeSummary() {
    this.tracker.printSummary();
  }
}

module.exports = { StateVerifier };
