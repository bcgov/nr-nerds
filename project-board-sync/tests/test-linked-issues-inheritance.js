/**
 * Test script to validate the inheritance of status, sprint, and assignment from PRs to linked issues
 * This script is focused on testing the fix for issue #76 and PR #78, ensuring that linked issues
 * properly inherit status, sprint, and assignments from PRs even if the PR's author is not GITHUB_AUTHOR
 */
const { Octokit } = require("@octokit/rest");
require('dotenv').config();

// Test constants
const GH_TOKEN = process.env.GH_TOKEN;
const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg'; // Production project ID

// Status field options from the main script
const STATUS_OPTIONS = {
  parked: '5bc8cfd4',
  new: 'f8e1e5a4',
  next: '2f5fe74c',
  active: '47fc9ee4',
  done: '98236657',
  backlog: 'bcdf8802'
};

// Status field ID
const STATUS_FIELD_ID = 'PVTF_lADOAA37OM4AFuzgzgKvD44';
// Sprint field ID
const SPRINT_FIELD_ID = 'PVTF_lADOAA37OM4AFuzgzgKzfWE';

// Test scenario: Simulate a PR with linked issues and verify inheritance behavior
async function testLinkedIssueInheritance() {
  if (!GH_TOKEN) {
    console.error("Error: GH_TOKEN environment variable not set.");
    console.log("Please create a .env file with GH_TOKEN=your_token");
    process.exit(1);
  }
  
  const octokit = new Octokit({ auth: GH_TOKEN });
  
  try {
    console.log("=== Testing Linked Issue Inheritance ===");
    console.log("This test verifies that linked issues correctly inherit status, sprint, and assignment from PRs");
    
    // Step 1: Let's first check the current status of PR #78 and issue #76
    console.log("\nStep 1: Fetching PR #78 and issue #76 details...");
    const OWNER = 'bcgov';
    const REPO = 'nr-nerds';
    const PR_NUMBER = 78;
    const ISSUE_NUMBER = 76;
    
    // Fetch PR details
    const pr = await octokit.pulls.get({
      owner: OWNER,
      repo: REPO,
      pull_number: PR_NUMBER
    });
    
    // Fetch issue details
    const issue = await octokit.issues.get({
      owner: OWNER,
      repo: REPO,
      issue_number: ISSUE_NUMBER
    });
    
    console.log(`PR #${PR_NUMBER}: ${pr.data.title} (${pr.data.state}, merged: ${pr.data.merged ? 'Yes' : 'No'})`);
    console.log(`Issue #${ISSUE_NUMBER}: ${issue.data.title} (${issue.data.state})`);
    console.log(`PR author: ${pr.data.user.login}`);
    console.log(`PR assignees: ${pr.data.assignees.map(a => a.login).join(', ') || 'None'}`);
    console.log(`Issue assignees: ${issue.data.assignees.map(a => a.login).join(', ') || 'None'}`);
    
    // Step 2: Check if the PR has linked issues
    console.log("\nStep 2: Checking PR linked issues...");
    const prDetails = await octokit.graphql(`
      query($owner: String!, $repo: String!, $prNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            closingIssuesReferences(first: 10) {
              nodes {
                number
                title
                repository {
                  nameWithOwner
                }
              }
            }
          }
        }
      }
    `, {
      owner: OWNER,
      repo: REPO,
      prNumber: PR_NUMBER
    });
    
    const closingIssues = prDetails.repository.pullRequest.closingIssuesReferences.nodes;
    console.log(`Closing issues references: ${closingIssues.length}`);
    closingIssues.forEach(issue => {
      console.log(`- #${issue.number}: ${issue.title} [${issue.repository.nameWithOwner}]`);
    });
    
    // Step 3: Check if the PR and issue are in the project board
    console.log("\nStep 3: Checking items in project board...");
    
    // Check PR in project
    const prInProject = await checkItemInProject(octokit, pr.data.node_id);
    console.log("\nPR in Project Board:");
    logProjectItem(prInProject);
    
    // Check issue in project
    const issueInProject = await checkItemInProject(octokit, issue.data.node_id);
    console.log("\nIssue in Project Board:");
    logProjectItem(issueInProject);
    
    // Step 4: Simulate the isPRMerged function from the main script
    console.log("\nStep 4: Testing PR merged detection logic...");
    const hasLinkedIssues = closingIssues.length > 0;
    const isMergedByFlag = pr.data.merged === true;
    const isMergedByLogic = pr.data.merged === true || (pr.data.state === 'closed' && hasLinkedIssues);
    
    console.log(`PR #${PR_NUMBER} merged flag: ${isMergedByFlag}`);
    console.log(`PR #${PR_NUMBER} has linked issues: ${hasLinkedIssues}`);
    console.log(`PR #${PR_NUMBER} is considered merged by logic: ${isMergedByLogic}`);
    
    // Step 5: Verify that this PR would trigger linked issue updates
    console.log("\nStep 5: Verifying PR would process linked issues...");
    if (isMergedByLogic || pr.data.state === 'open') {
      console.log("✅ This PR would process linked issues (is merged or open)");
    } else {
      console.log("❌ This PR would NOT process linked issues (not merged or open)");
    }
    
    // Summary
    console.log("\n=== Test Summary ===");
    if (isMergedByLogic) {
      console.log(`✅ PR #${PR_NUMBER} is correctly identified as merged.`);
      if (issueInProject) {
        console.log(`✅ Issue #${ISSUE_NUMBER} is in the project board.`);
        if (prInProject && issueInProject) {
          if (getStatusFromItem(prInProject) === getStatusFromItem(issueInProject)) {
            console.log("✅ Issue has correctly inherited the PR's status.");
          } else {
            console.log(`❌ Issue has status "${getStatusFromItem(issueInProject)}" while PR has "${getStatusFromItem(prInProject)}".`);
          }
          
          if (getSprintFromItem(prInProject) && getSprintFromItem(issueInProject) && 
              getSprintFromItem(prInProject) === getSprintFromItem(issueInProject)) {
            console.log("✅ Issue has correctly inherited the PR's sprint.");
          } else {
            console.log(`❌ Issue has sprint "${getSprintFromItem(issueInProject)}" while PR has "${getSprintFromItem(prInProject)}".`);
          }
        }
      } else {
        console.log(`❌ Issue #${ISSUE_NUMBER} is not in the project board.`);
      }
    } else {
      console.log(`❓ PR #${PR_NUMBER} is not identified as merged - manual check needed.`);
    }
    
    // Check assignee inheritance
    if (issue.data.assignees && issue.data.assignees.length > 0) {
      // If PR has assignees, issue should inherit them
      if (pr.data.assignees && pr.data.assignees.length > 0) {
        const prAssignee = pr.data.assignees[0].login;
        if (issue.data.assignees.some(a => a.login === prAssignee)) {
          console.log(`✅ Issue is correctly assigned to PR assignee (${prAssignee}).`);
        } else {
          console.log(`❌ Issue is not assigned to PR assignee (${prAssignee}), but to ${issue.data.assignees.map(a => a.login).join(', ')}.`);
        }
      }
      // If PR has no assignees, issue should be assigned to PR author as fallback
      else if (issue.data.assignees.some(a => a.login === pr.data.user.login)) {
        console.log(`✅ Issue is assigned to PR author (${pr.data.user.login}) as fallback since PR has no assignees.`);
      } else {
        console.log(`❌ Issue does not have correct assignees. PR has no assignees, so expected PR author (${pr.data.user.login}), but found ${issue.data.assignees.map(a => a.login).join(', ')}.`);
      }
    } else {
      if (pr.data.assignees && pr.data.assignees.length > 0) {
        console.log(`❌ Issue has no assignees, should be assigned to PR assignee (${pr.data.assignees[0].login}).`);
      } else {
        console.log(`❌ Issue has no assignees, should be assigned to PR author (${pr.data.user.login}) as fallback.`);
      }
    }
    
  } catch (error) {
    console.error("Error during test:", error);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Message: ${error.response.data.message}`);
    }
  }
}

// Helper function to check if an item is in the project board
async function checkItemInProject(octokit, nodeId) {
  try {
    const result = await octokit.graphql(`
      query($projectId: ID!, $contentId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 1, filter: {contentId: $contentId}) {
              nodes {
                id
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2SingleSelectField { name } }
                    }
                    ... on ProjectV2ItemFieldIterationValue {
                      title
                      iterationId
                      startDate
                      duration
                      field { ... on ProjectV2IterationField { name } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, {
      projectId: PROJECT_ID,
      contentId: nodeId
    });
    
    const items = result.node.items.nodes;
    
    if (items.length === 0) {
      return null;
    }
    
    return items[0];
  } catch (error) {
    console.error(`Error checking item in project: ${error.message}`);
    return null;
  }
}

// Helper function to log project item details
function logProjectItem(item) {
  if (!item) {
    console.log("Item not found in project board");
    return;
  }
  
  console.log("Item found in project board");
  
  // Extract and display field values
  const fieldValues = item.fieldValues.nodes;
  fieldValues.forEach(value => {
    if (value.field && value.field.name === 'Status') {
      console.log(`- Status: ${value.name}`);
    } else if (value.field && value.field.name === 'Sprint') {
      console.log(`- Sprint: ${value.title} (${value.startDate}, ${value.duration} days)`);
    }
  });
}

// Helper to get status from project item
function getStatusFromItem(item) {
  if (!item) return null;
  
  const statusField = item.fieldValues.nodes.find(value => 
    value.field && value.field.name === 'Status'
  );
  
  return statusField ? statusField.name : null;
}

// Helper to get sprint from project item
function getSprintFromItem(item) {
  if (!item) return null;
  
  const sprintField = item.fieldValues.nodes.find(value => 
    value.field && value.field.name === 'Sprint'
  );
  
  return sprintField ? sprintField.title : null;
}

// Run the test
testLinkedIssueInheritance().catch(console.error);
