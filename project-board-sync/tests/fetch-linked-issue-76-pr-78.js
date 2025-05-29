/**
 * Test script to check the status of issue #76 and PR #78 and their linkage
 */
const { Octokit } = require("@octokit/rest");
require('dotenv').config();

// Main function to fetch and analyze issue #76 and PR #78
async function checkIssueAndPR() {
  const GH_TOKEN = process.env.GH_TOKEN;
  const OWNER = 'bcgov';
  const REPO = 'nr-nerds';
  const ISSUE_NUMBER = 76;
  const PR_NUMBER = 78;

  if (!GH_TOKEN) {
    console.error("Error: GH_TOKEN environment variable not set.");
    console.log("Please create a .env file with GH_TOKEN=your_token");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: GH_TOKEN });

  console.log(`Fetching issue #${ISSUE_NUMBER} from ${OWNER}/${REPO}...`);

  try {
    // Fetch the issue details
    const issue = await octokit.issues.get({
      owner: OWNER,
      repo: REPO,
      issue_number: ISSUE_NUMBER
    });

    console.log("\nISSUE DETAILS:");
    console.log(`- Title: ${issue.data.title}`);
    console.log(`- State: ${issue.data.state}`);
    console.log(`- Created: ${issue.data.created_at}`);
    console.log(`- Updated: ${issue.data.updated_at}`);
    console.log(`- Assignees: ${issue.data.assignees.map(a => a.login).join(', ') || 'None'}`);
    
    // Fetch the PR details
    console.log(`\nFetching PR #${PR_NUMBER} from ${OWNER}/${REPO}...`);
    const pr = await octokit.pulls.get({
      owner: OWNER,
      repo: REPO,
      pull_number: PR_NUMBER
    });
    
    console.log("\nPR DETAILS:");
    console.log(`- Title: ${pr.data.title}`);
    console.log(`- State: ${pr.data.state}`);
    console.log(`- Merged: ${pr.data.merged ? 'Yes' : 'No'}`);
    console.log(`- Created: ${pr.data.created_at}`);
    console.log(`- Updated: ${pr.data.updated_at}`);
    console.log(`- Merged at: ${pr.data.merged_at || 'Not merged'}`);
    console.log(`- Closed at: ${pr.data.closed_at || 'Not closed'}`);
    console.log(`- Assignees: ${pr.data.assignees.map(a => a.login).join(', ') || 'None'}`);
    
    // Check if the PR has linked issues
    console.log("\nChecking PR linked issues...");
    const linkedIssues = await checkPRLinkedIssues(octokit, OWNER, REPO, PR_NUMBER);
    
    // Check if the issue is in the project and get its status
    console.log("\nChecking issue in project board...");
    await checkIssueInProject(octokit, issue.data.node_id);
    
    // Check if the PR is in the project and get its status
    console.log("\nChecking PR in project board...");
    await checkIssueInProject(octokit, pr.data.node_id);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Message: ${error.response.data.message}`);
    }
  }
}

async function checkPRLinkedIssues(octokit, owner, repo, prNumber) {
  try {
    // Get the timeline events to find linked issues
    const timelineItems = await octokit.issues.listEventsForTimeline({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100
    });
    
    console.log(`Timeline events: ${timelineItems.data.length}`);
    
    // Look for connected events
    const connectedEvents = timelineItems.data.filter(event => 
      event.event === 'connected' || 
      event.event === 'cross-referenced'
    );
    
    console.log(`Found ${connectedEvents.length} connected/cross-referenced events`);
    
    // Check for specific issue being linked
    const issue76Links = connectedEvents.filter(event => {
      return event.source && 
             event.source.issue && 
             event.source.issue.number === 76;
    });
    
    console.log(`Links to issue #76: ${issue76Links.length}`);
    
    // Get closing references
    console.log("\nChecking for closing references...");
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
      owner,
      repo,
      prNumber
    });
    
    const closingIssues = prDetails.repository.pullRequest.closingIssuesReferences.nodes;
    console.log(`Closing issues references: ${closingIssues.length}`);
    closingIssues.forEach(issue => {
      console.log(`- #${issue.number}: ${issue.title} [${issue.repository.nameWithOwner}]`);
    });
    
    return closingIssues;
  } catch (error) {
    console.error(`Error checking PR links: ${error.message}`);
    return [];
  }
}

async function checkIssueInProject(octokit, nodeId) {
  try {
    // Use GitHub GraphQL to find the item in the project
    const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';
    
    const result = await octokit.graphql(`
      query($projectId: ID!, $contentId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 1, filter: {contentId: $contentId}) {
              nodes {
                id
                fieldValues(first: 10) {
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
      console.log("Item not found in project board");
      return null;
    }
    
    console.log("Item found in project board");
    
    // Extract and display field values
    const fieldValues = items[0].fieldValues.nodes;
    console.log("Field values:");
    
    fieldValues.forEach(value => {
      if (value.field && value.field.name === 'Status') {
        console.log(`- Status: ${value.name}`);
      } else if (value.field && value.field.name === 'Sprint') {
        console.log(`- Sprint: ${value.title} (${value.startDate}, ${value.duration} days)`);
      }
    });
    
    return items[0];
  } catch (error) {
    console.error(`Error checking item in project: ${error.message}`);
    return null;
  }
}

// Run the function
checkIssueAndPR();
