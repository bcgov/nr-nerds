const { octokit } = require('../github/api');
const { log, Logger } = require('../utils/log');
const { getItemColumn, setItemColumn } = require('../github/api');
const { processSprintAssignment } = require('./sprints');
const { getItemAssignees, setItemAssignees } = require('./assignees');

async function processLinkedIssues(pullRequest, projectItemId, projectId, currentColumn) {
  const { id: pullRequestId, number: pullRequestNumber, repository: { nameWithOwner: repositoryName }, state, merged, assignees, linkedIssues } = pullRequest;

  let changed = false;
  let reason = '';
  const linkedIssueResults = [];

  log.info(`Processing linked issues for PR #${pullRequestNumber} in ${repositoryName}`);

  if (linkedIssues.nodes.length === 0) {
    reason = 'No linked issues';
    log.info(`No linked issues found for PR #${pullRequestNumber}`);
    return { changed, reason, linkedIssues: linkedIssueResults };
  }

  if (state === 'CLOSED' && !merged) {
    reason = 'PR is closed but not merged';
    log.info(`Skipping closed but unmerged PR #${pullRequestNumber}`);
    return { changed, reason, linkedIssues: linkedIssueResults };
  }

  for (const linkedIssue of linkedIssues.nodes) {
    const { id: linkedIssueId, number: linkedIssueNumber, repository: { nameWithOwner: linkedIssueRepositoryName } } = linkedIssue;

    try {
      // Sync column
      if (currentColumn) {
        await setItemColumn(projectId, linkedIssueId, currentColumn);
        log.info(`Set linked issue #${linkedIssueNumber} column to ${currentColumn}`);
      }

      // Sync assignees
      const prAssignees = assignees.nodes.map(a => a.login);
      if (prAssignees.length > 0) {
        await setItemAssignees(projectId, linkedIssueId, prAssignees);
        log.info(`Set linked issue #${linkedIssueNumber} assignees to: ${prAssignees.join(', ')}`);
      }

      linkedIssueResults.push({
        id: linkedIssueId,
        number: linkedIssueNumber,
        column: currentColumn,
        assignees: prAssignees
      });

      changed = true;      } catch (error) {
        log.error(`Error updating linked issue ${linkedIssueNumber} in repository ${linkedIssueRepositoryName}: ${error.message}`);
        throw error;
      }
  }

  return { changed, reason, linkedIssues: linkedIssueResults };
}

module.exports = {
  processLinkedIssues
};
