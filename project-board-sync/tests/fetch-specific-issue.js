/**
 * This script fetches a specific issue and adds it to the project board
 */

const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");

// Environment variables
const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

// Project configuration (copied from project-sync.js)
const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';
const STATUS_OPTIONS = {
  parked: '5bc8cfd4',
  new: 'f8e1e5a4',
  backlog: 'd8686046',
  next: 'ab0fb504',
  active: 'c66ba2dd',
  waiting: 'cd3ebcfd',
  done: '46321e20'
};

async function getIssue(owner, repo, issueNumber) {
  try {
    console.log(`Fetching issue #${issueNumber} from ${owner}/${repo}...`);
    
    const { data } = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber
    });
    
    console.log(`Found issue #${issueNumber}: ${data.title}`);
    console.log(`Assigned to: ${data.assignee ? data.assignee.login : 'nobody'}`);
    
    return {
      id: data.node_id,
      number: data.number,
      title: data.title,
      state: data.state.toUpperCase(),
      type: 'Issue',
      repoName: `${owner}/${repo}`,
      assignees: data.assignees.map(a => a.login),
      url: data.url,
      htmlUrl: data.html_url
    };
  } catch (error) {
    console.error(`Error fetching issue:`, error);
    return null;
  }
}

async function findOrAddItemToProject(contentId) {
  try {
    // First, check if the item is already in the project
    const existingItem = await octokit.graphql(`
      query($projectId: ID!, $contentId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 1, filters: {contentId: $contentId}) {
              nodes {
                id
                content {
                  ... on Issue {
                    number
                    repository { nameWithOwner }
                  }
                  ... on PullRequest {
                    number
                    repository { nameWithOwner }
                  }
                }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2SingleSelectField { name } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, { projectId: PROJECT_ID, contentId });

    const projectItems = existingItem.node.items.nodes;
    
    if (projectItems.length > 0) {
      console.log(`Item already exists in the project board`);
      return { projectItemId: projectItems[0].id, wasAdded: false };
    }
    
    // If not found, add it
    console.log(`Adding item to project board...`);
    const result = await octokit.graphql(`
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
          item {
            id
          }
        }
      }
    `, { projectId: PROJECT_ID, contentId });
    
    console.log(`Successfully added item to project board`);
    return { projectItemId: result.addProjectV2ItemById.item.id, wasAdded: true };
  } catch (error) {
    console.error(`Error adding item to project:`, error);
    if (error.errors) {
      console.error(`GraphQL errors:`, error.errors);
    }
    return { projectItemId: null, wasAdded: false };
  }
}

async function updateItemStatus(projectItemId, statusOption) {
  try {
    await octokit.graphql(`
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `, {
      projectId: PROJECT_ID,
      itemId: projectItemId,
      fieldId: STATUS_FIELD_ID, // Status field ID from config
      optionId: statusOption
    });
    
    console.log(`Successfully updated status of project item`);
    return true;
  } catch (error) {
    console.error(`Error updating item status:`, error);
    return false;
  }
}

async function main() {
  try {
    const issue = await getIssue('bcgov', 'nr-forest-client', 1603);
    
    if (!issue) {
      console.log('Issue not found or error occurred');
      return;
    }
    
    console.log('Adding issue to project board...');
    const { projectItemId, wasAdded } = await findOrAddItemToProject(issue.id);
    
    if (!projectItemId) {
      console.log('Failed to add issue to project board');
      return;
    }
    
    if (wasAdded) {
      console.log('Setting initial status to "New"...');
      await updateItemStatus(projectItemId, STATUS_OPTIONS.new);
    }
    
    console.log('Done!');
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
