/**
 * Script to diagnose and fix issue 76 not receiving the correct assignee, column, and sprint
 * from its linked PR 78.
 */
require('dotenv').config();
const { octokit } = require('../src/github/api');
const { log } = require('../src/utils/log');
const { processLinkedIssues } = require('../src/rules/linked-issues');
const { getItemAssignees } = require('../src/rules/assignees');
const { setItemColumn } = require('../src/github/api');

// Constants
const OWNER = 'bcgov';
const REPO = 'nr-nerds';
const PR_NUMBER = 78;
const ISSUE_NUMBER = 76;
const PROJECT_ID = process.env.PROJECT_ID || 'PVT_kwDOAA37OM4AFuzg';
const COLUMN_NAME = 'Active';  // The column name for "Active"

async function getProjectItemIds() {
  try {
    log.info('Fetching project item IDs...');

    // Get PR node ID
    const prResult = await octokit.graphql(`
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            id
            title
            projectItems(first: 10) {
              nodes {
                id
                project {
                  id
                  title
                }
              }
            }
          }
        }
      }
    `, {
      owner: OWNER,
      repo: REPO,
      number: PR_NUMBER
    });

    const pr = prResult.repository.pullRequest;
    log.info(`Found PR #${PR_NUMBER}: ${pr.title}`);

    // Get Issue node ID
    const issueResult = await octokit.graphql(`
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id
            title
            projectItems(first: 10) {
              nodes {
                id
                project {
                  id
                  title
                }
              }
            }
          }
        }
      }
    `, {
      owner: OWNER,
      repo: REPO,
      number: ISSUE_NUMBER
    });

    const issue = issueResult.repository.issue;
    log.info(`Found Issue #${ISSUE_NUMBER}: ${issue.title}`);

    // Get PR's project item ID
    const prProjectItem = pr.projectItems.nodes.find(item => 
      item.project.id === PROJECT_ID
    );
    
    // Get Issue's project item ID
    const issueProjectItem = issue.projectItems.nodes.find(item => 
      item.project.id === PROJECT_ID
    );

    return {
      pr: {
        id: pr.id,
        projectItemId: prProjectItem?.id,
        title: pr.title
      },
      issue: {
        id: issue.id,
        projectItemId: issueProjectItem?.id,
        title: issue.title
      }
    };
  } catch (error) {
    log.error(`Failed to get project item IDs: ${error.message}`);
    throw error;
  }
}

async function checkItemAttributes(itemIds) {
  try {
    log.info('\nChecking current attributes...');

    // Check if PR is in project
    if (!itemIds.pr.projectItemId) {
      log.warn(`PR #${PR_NUMBER} is not in the project!`);
    } else {
      log.info(`PR #${PR_NUMBER} is in the project with item ID: ${itemIds.pr.projectItemId}`);
      
      // Check PR assignees
      const prAssignees = await getItemAssignees(PROJECT_ID, itemIds.pr.projectItemId);
      log.info(`PR #${PR_NUMBER} assignees: ${prAssignees.join(', ') || 'none'}`);
    }

    // Check if issue is in project
    if (!itemIds.issue.projectItemId) {
      log.warn(`Issue #${ISSUE_NUMBER} is not in the project!`);
    } else {
      log.info(`Issue #${ISSUE_NUMBER} is in the project with item ID: ${itemIds.issue.projectItemId}`);
      
      // Check issue assignees
      const issueAssignees = await getItemAssignees(PROJECT_ID, itemIds.issue.projectItemId);
      log.info(`Issue #${ISSUE_NUMBER} assignees: ${issueAssignees.join(', ') || 'none'}`);
    }

    return !!itemIds.pr.projectItemId && !!itemIds.issue.projectItemId;
  } catch (error) {
    log.error(`Failed to check item attributes: ${error.message}`);
    return false;
  }
}

async function fixLinkedIssue(itemIds) {
  try {
    log.info('\nAttempting to fix Issue #76 by processing linked issues for PR #78...');
    
    // Create a PR object structure similar to what our main function uses
    const prItem = {
      __typename: 'PullRequest',
      number: PR_NUMBER,
      id: itemIds.pr.id,
      projectItemId: itemIds.pr.projectItemId,
      repository: {
        nameWithOwner: `${OWNER}/${REPO}`
      }
    };
    
    // Process linked issues
    const result = await processLinkedIssues(
      prItem,
      PROJECT_ID,
      COLUMN_NAME,
      'Current Sprint'  // Current sprint name or ID
    );
    
    log.info(`Processed ${result.processed} linked issues with ${result.errors} errors`);
    return result.processed > 0;
  } catch (error) {
    log.error(`Failed to fix linked issue: ${error.message}`);
    return false;
  }
}

async function main() {
  try {
    log.info('Starting Issue 76 diagnosis and fix script...');
    
    // Get project item IDs
    const itemIds = await getProjectItemIds();
    
    // Check current attributes
    const bothInProject = await checkItemAttributes(itemIds);
    
    if (!bothInProject) {
      log.error('Cannot proceed with fix - one or both items not in project');
      return;
    }
    
    // Fix linked issue
    const fixed = await fixLinkedIssue(itemIds);
    
    if (fixed) {
      log.info('\nSuccessfully processed linked issue relationship!');
      
      // Verify changes
      log.info('\nVerifying changes...');
      await checkItemAttributes(itemIds);
    } else {
      log.error('Failed to fix linked issue relationship');
    }
    
    log.info('\nScript complete.');
  } catch (error) {
    log.error(`Script failed: ${error.message}`);
  }
}

// Run the script
main();
