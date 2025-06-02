const { isItemInProject, getItemColumn, getItemAssignees } = require('../github/api');
const { getItemSprint } = require('../rules/sprints');
const { log } = require('./log');

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * Sleep for a specified number of milliseconds
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Try an operation multiple times with exponential backoff
 */
async function retry(operation, description, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
        log.info(`Verification attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to verify ${description} after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Compare two values and return a diff-like description
 */
function getDiff(before, after, path = '') {
  if (typeof before !== typeof after) {
    return [`${path}: changed from ${typeof before} to ${typeof after}`];
  }

  if (Array.isArray(before)) {
    const added = after.filter(item => !before.includes(item));
    const removed = before.filter(item => !after.includes(item));
    const diffs = [];
    if (added.length) diffs.push(`${path}: added ${added.join(', ')}`);
    if (removed.length) diffs.push(`${path}: removed ${removed.join(', ')}`);
    return diffs;
  }

  if (before && typeof before === 'object') {
    const diffs = [];
    const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const key of allKeys) {
      const keyPath = path ? `${path}.${key}` : key;
      if (!(key in before)) {
        diffs.push(`${keyPath}: added ${JSON.stringify(after[key])}`);
      } else if (!(key in after)) {
        diffs.push(`${keyPath}: removed`);
      } else {
        diffs.push(...getDiff(before[key], after[key], keyPath));
      }
    }
    return diffs;
  }

  if (before !== after) {
    return [`${path}: changed from ${before} to ${after}`];
  }

  return [];
}

/**
 * Verifies that an item's state matches expectations after a change
 */
class StateVerifier {
  /**
   * Verify an item was added to the project
   */
  static async verifyAddition(item, projectId) {
    // Wait a bit for the addition to propagate through GitHub's systems
    await sleep(2000);
    
    return retry(async () => {
      log.info(`Verifying addition of ${item.type} #${item.number} to project ${projectId}...`);
      const { isInProject, projectItemId } = await isItemInProject(item.id, projectId);
      
      if (!isInProject || !projectItemId) {
        log.error(`Failed to verify item in project. Item ID: ${item.id}, Project ID: ${projectId}`);
        throw new Error(`Item ${item.type} #${item.number} was not added to project`);
      }
      
      log.info(`Successfully verified ${item.type} #${item.number} in project with item ID: ${projectItemId}`);
      log.logState(item.id, 'Addition Verified', { inProject: true, projectItemId });
      return projectItemId;
    }, `project addition for ${item.type} #${item.number}`);
  }

  /**
   * Verify an item's column matches expected state
   */
  static async verifyColumn(item, projectId, expectedColumn) {
    return retry(async () => {
      const currentColumn = await getItemColumn(projectId, item.projectItemId);
      if (currentColumn?.toLowerCase() !== expectedColumn?.toLowerCase()) {
        const diff = getDiff(
          { column: expectedColumn?.toLowerCase() },
          { column: currentColumn?.toLowerCase() }
        );
        throw new Error(
          `Column mismatch for ${item.type} #${item.number}:\n` +
          diff.map(d => `  ${d}`).join('\n')
        );
      }
      log.logState(item.id, 'Column Verified', { column: currentColumn });
      return currentColumn;
    }, `column state for ${item.type} #${item.number}`);
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
   * Verify linked issues are in the expected state
   */
  static async verifyLinkedIssues(item, projectId, linkedIssues, expectedColumn, expectedSprint) {
    return retry(async () => {
      const verificationResults = await Promise.all(
        linkedIssues.map(async (linkedIssue) => {
          const { isInProject, projectItemId } = await isItemInProject(linkedIssue.id, projectId);
          if (!isInProject) {
            return {
              issue: linkedIssue,
              error: 'Not in project'
            };
          }

          const column = await getItemColumn(projectId, projectItemId);
          if (column?.toLowerCase() !== expectedColumn?.toLowerCase()) {
            return {
              issue: linkedIssue,
              error: `Wrong column: expected "${expectedColumn}", got "${column}"`
            };
          }

          if (expectedSprint) {
            const { sprintId } = await getItemSprint(projectId, projectItemId);
            if (sprintId !== expectedSprint) {
              return {
                issue: linkedIssue,
                error: `Wrong sprint: expected "${expectedSprint}", got "${sprintId}"`
              };
            }
          }

          return { issue: linkedIssue, verified: true };
        })
      );

      const failed = verificationResults.filter(r => !r.verified);
      if (failed.length > 0) {
        throw new Error(
          `Linked issues verification failed for ${item.type} #${item.number}:\n` +
          failed.map(f => `  Issue #${f.issue.number}: ${f.error}`).join('\n')
        );
      }

      log.logState(item.id, 'Linked Issues Verified', {
        linkedIssues: linkedIssues.map(i => i.number),
        column: expectedColumn,
        sprint: expectedSprint
      });

      return verificationResults;
    }, `linked issues state for ${item.type} #${item.number}`);
  }
}

module.exports = { StateVerifier };
