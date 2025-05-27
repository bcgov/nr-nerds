// A simple script to test the sprint assignment logic for "Done" column items
const { Octokit } = require("@octokit/rest");

// Get GitHub token from environment variable
const GH_TOKEN = process.env.GH_TOKEN;
const octokit = new Octokit({ auth: GH_TOKEN });

// Constants from project-sync.js
const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';
const SPRINT_FIELD_ID = 'PVTIF_lADOAA37OM4AFuzgzgDTbhE';

/**
 * Gets the current Sprint iteration ID
 */
async function getCurrentSprintOptionId() {
  console.log("Getting current sprint...");
  const res = await octokit.graphql(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2IterationField {
                id
                name
                configuration {
                  ... on ProjectV2IterationFieldConfiguration {
                    iterations {
                      id
                      title
                      startDate
                      duration
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  
  const sprintField = res.node.fields.nodes.find(f => f.id === SPRINT_FIELD_ID);
  if (!sprintField) {
    throw new Error('Sprint field not found in project configuration.');
  }
  
  const today = new Date();
  // Find the iteration (sprint) whose startDate <= today < startDate+duration
  const iterations = sprintField.configuration?.iterations || [];
  for (const iter of iterations) {
    const start = new Date(iter.startDate);
    const end = new Date(start.getTime() + iter.duration * 24 * 60 * 60 * 1000);
    if (today >= start && today < end) {
      console.log(`Current sprint: ${iter.title} (ID: ${iter.id})`);
      return iter.id;
    }
  }
  
  throw new Error(`No Sprint iteration with a date range including today (${today.toISOString().slice(0,10)})`);
}

/**
 * Get the current sprint field value for a project item
 */
async function getItemSprint(projectItemId) {
  try {
    const res = await octokit.graphql(`
      query getItemFieldValues($itemId: ID!) {
        node(id: $itemId) {
          ... on ProjectV2Item {
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldIterationValue {
                  iterationId
                  title
                  field { ... on ProjectV2IterationField { name } }
                }
              }
            }
          }
        }
      }
    `, { 
      itemId: projectItemId
    });
    
    if (!res.node?.fieldValues?.nodes) return null;
    
    const sprintField = res.node.fieldValues.nodes.find(
      fv => fv.field && fv.field.name === 'Sprint'
    );

    return sprintField ? { id: sprintField.iterationId, title: sprintField.title } : null;
  } catch (err) {
    console.error(`Error getting sprint field for item ${projectItemId}: ${err.message}`);
    return null;
  }
}

/**
 * Set the sprint field for a project item
 */
async function setItemSprint(projectItemId, sprintId) {
  console.log(`Setting sprint ${sprintId} for item ${projectItemId}...`);
  try {
    await octokit.graphql(`
      mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $iterationId:String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { iterationId: $iterationId }
        }) { 
          projectV2Item { 
            id 
          } 
        }
      }
    `, {
      projectId: PROJECT_ID,
      itemId: projectItemId,
      fieldId: SPRINT_FIELD_ID,
      iterationId: String(sprintId)
    });
    
    console.log(`Sprint updated successfully`);
    return true;
  } catch (err) {
    console.error(`Error setting sprint: ${err.message}`);
    return false;
  }
}

/**
 * Get the item ID for an issue or PR in the project
 */
async function getProjectItemId(itemNumber, repoOwner, repoName) {
  try {
    console.log(`Looking for item #${itemNumber} in ${repoOwner}/${repoName}...`);
    // First get the content ID
    const issueRes = await octokit.issues.get({
      owner: repoOwner,
      repo: repoName,
      issue_number: itemNumber
    });
    
    const contentId = issueRes.data.node_id;
    console.log(`Found content ID: ${contentId}`);
    
    // Then find it in the project
    let endCursor = null;
    let projectItemId = null;
    
    do {
      const res = await octokit.graphql(`
        query($projectId:ID!, $after:String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: 100, after: $after) {
                nodes { 
                  id 
                  content { 
                    ... on PullRequest { id }
                    ... on Issue { id } 
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `, { projectId: PROJECT_ID, after: endCursor });
      
      const items = res.node.items.nodes;
      const match = items.find(item => item.content && item.content.id === contentId);
      
      if (match) {
        projectItemId = match.id;
        console.log(`Found project item ID: ${projectItemId}`);
        break;
      }
      
      if (!res.node.items.pageInfo.hasNextPage) {
        break;
      }
      
      endCursor = res.node.items.pageInfo.endCursor;
    } while (endCursor);
    
    if (!projectItemId) {
      throw new Error(`Item #${itemNumber} not found in project`);
    }
    
    return projectItemId;
  } catch (err) {
    console.error(`Error finding project item: ${err.message}`);
    throw err;
  }
}

/**
 * Main test function
 */
async function testSprintAssignment() {
  try {
    // Configuration - update these values to test with your own items
    const TEST_ITEM_NUMBER = 73; // Replace with a real issue or PR number
    const REPO_OWNER = 'bcgov';
    const REPO_NAME = 'nr-nerds';
    
    // 1. Get the current sprint
    const currentSprintId = await getCurrentSprintOptionId();
    
    // 2. Get the project item ID
    const projectItemId = await getProjectItemId(TEST_ITEM_NUMBER, REPO_OWNER, REPO_NAME);
    
    // 3. Get the current sprint assigned to the item
    const initialSprint = await getItemSprint(projectItemId);
    console.log(`Initial sprint: ${initialSprint ? `${initialSprint.title} (${initialSprint.id})` : 'None'}`);
    
    // 4. Test the shouldUpdateSprint logic
    // Function to simulate the logic in project-sync.js
    function shouldUpdateSprint(currentSprint, targetSprint, isInDoneColumn) {
      const alreadyHasCorrectSprint = currentSprint === targetSprint;
      
      if (isInDoneColumn) {
        return !alreadyHasCorrectSprint && !currentSprint; // For Done: only update if no sprint
      } else {
        return !alreadyHasCorrectSprint; // For Next/Active: update if sprint doesn't match
      }
    }
    
    // Create test cases to validate our logic
    const testCases = [
      { 
        name: "Done column, no sprint assigned", 
        currentSprint: null,
        isInDoneColumn: true,
        expected: true
      },
      { 
        name: "Done column, has current sprint", 
        currentSprint: String(currentSprintId),
        isInDoneColumn: true,
        expected: false 
      },
      { 
        name: "Done column, has different sprint", 
        currentSprint: "some-other-sprint-id",
        isInDoneColumn: true,
        expected: false // Changed from true to false - don't replace existing sprints
      },
      { 
        name: "Active column, no sprint assigned", 
        currentSprint: null,
        isInDoneColumn: false,
        expected: true
      },
      { 
        name: "Active column, has current sprint", 
        currentSprint: String(currentSprintId),
        isInDoneColumn: false,
        expected: false 
      },
      { 
        name: "Active column, has different sprint", 
        currentSprint: "some-other-sprint-id",
        isInDoneColumn: false,
        expected: true
      }
    ];
    
    // Run test cases
    console.log("\n==== Sprint Assignment Logic Tests ====");
    for (const test of testCases) {
      const result = shouldUpdateSprint(
        test.currentSprint, 
        String(currentSprintId), 
        test.isInDoneColumn
      );
      
      const passed = result === test.expected;
      console.log(`Test: ${test.name}`);
      console.log(`  Current Sprint: ${test.currentSprint || 'None'}`);
      console.log(`  Target Sprint: ${currentSprintId}`);
      console.log(`  In Done Column: ${test.isInDoneColumn}`);
      console.log(`  Should Update: ${result} (Expected: ${test.expected})`);
      console.log(`  Result: ${passed ? 'PASS' : 'FAIL'}`);
    }
    
    console.log("\nTest completed!");
  } catch (error) {
    console.error(`Test failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the test
testSprintAssignment().catch(err => {
  console.error('Uncaught error:', err);
  process.exit(1);
});
