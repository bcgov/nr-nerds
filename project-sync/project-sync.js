const { graphql } = require("@octokit/graphql");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
// TODO: In the future, look up PROJECT_ID dynamically using org and project number.
// For now, PROJECT_ID is hardcoded as: PVT_kwDOAA37OM4AFuzg
const PROJECT_ID = "PVT_kwDOAA37OM4AFuzg"; // GitHub Project (beta) node ID
const ORG = process.env.ORG || "bcgov";
const PROJECT_NUMBER = process.env.PROJECT_NUMBER || 16; // Default to 16 if not set

// NOTE: This script is now fully hardcoded to use the project node ID.
// If you want to use dynamic lookup by project number, use sync-to-project.js as your entrypoint instead of project-sync.js.

const graphqlWithAuth = graphql.defaults({
  headers: { authorization: `token ${GH_TOKEN}` },
});

const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

const RECENT_DAYS = 2;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || 'DerekRoberts';

// Helper to ensure repo is in owner/repo format
function withOrg(repo, org) {
  if (repo.includes('/')) return repo;
  return `${org}/${repo}`;
}

// Get project and fields using correct GraphQL fragments for all field types
async function getProjectAndFields(org, projectNumber) {
  const projectRes = await graphqlWithAuth(`
    query($org: String!, $number: Int!) {
      organization(login: $org) {
        projectV2(number: $number) {
          id
          title
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
              ... on ProjectV2IterationField {
                id
                name
                configuration { iterations { id title startDate } }
              }
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `, { org, number: Number(projectNumber) });
  return projectRes.organization.projectV2;
}

// Dynamically fetch the Sprint field and select the current sprint option
async function getCurrentSprintValue() {
  const projectRes = await graphqlWithAuth(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  const fields = projectRes.node.fields.nodes;
  // Find the Sprint field (single-select or iteration)
  let sprintField = fields.find(f => f.name && f.name.trim().toLowerCase() === 'sprint' && (f.options || f.configuration));
  if (!sprintField) {
    console.error('Could not find a Sprint field. Dumping all available project fields:');
    fields.forEach((f, idx) => {
      console.error(`--- Field #${idx + 1} ---`);
      console.error(JSON.stringify(f, null, 2));
    });
    throw new Error('Could not find a Sprint field');
  }
  // If iteration field, find the latest sprint whose startDate is not in the future
  if (sprintField.configuration && sprintField.configuration.iterations) {
    const today = new Date();
    let currentSprint = null;
    for (const iter of sprintField.configuration.iterations) {
      const sprintDate = new Date(iter.startDate);
      if (sprintDate <= today && (!currentSprint || sprintDate > new Date(currentSprint.date))) {
        currentSprint = { id: iter.id, name: iter.title, date: iter.startDate };
      }
    }
    if (!currentSprint) throw new Error('Could not determine current sprint from Sprint iteration field');
    return { fieldId: sprintField.id, value: currentSprint.id };
  }
  // If single-select, use previous logic
  const today = new Date();
  let currentSprint = null;
  for (const opt of sprintField.options || []) {
    const match = opt.name.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const sprintDate = new Date(match[1]);
      if (sprintDate <= today && (!currentSprint || sprintDate > new Date(currentSprint.date))) {
        currentSprint = { id: opt.id, name: opt.name, date: match[1] };
      }
    }
  }
  if (!currentSprint) throw new Error('Could not determine current sprint from Sprint field options');
  return { fieldId: sprintField.id, value: currentSprint.name };
}

// Dynamically fetch the Sprint field and select the current sprint iteration (date overlap)
async function getCurrentSprintIteration() {
  const projectRes = await graphqlWithAuth(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 30) {
            nodes {
              ... on ProjectV2IterationField {
                id
                name
                configuration { iterations { id title startDate duration } }
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  const fields = projectRes.node.fields.nodes;
  // Find the Sprint field (iteration type, case-insensitive)
  const sprintField = fields.find(f => f.name && f.name.trim().toLowerCase() === 'sprint' && f.configuration && f.configuration.iterations);
  if (!sprintField) throw new Error('Could not find a Sprint iteration field');
  const today = new Date();
  for (const iter of sprintField.configuration.iterations) {
    const start = new Date(iter.startDate);
    const end = new Date(start);
    // duration is in days
    end.setDate(start.getDate() + (iter.duration || 13));
    if (today >= start && today <= end) {
      return { fieldId: sprintField.id, iterationId: iter.id, title: iter.title };
    }
  }
  throw new Error('Could not determine current sprint iteration');
}

async function addToProject(contentId) {
  // Add item to project
  const addRes = await graphqlWithAuth(`
    mutation($projectId:ID!, $contentId:ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }
  `, { projectId: PROJECT_ID, contentId });
  return addRes.addProjectV2ItemById.item.id;
}

// Helper to fetch the global node ID for a single-select option
async function getGlobalNodeIdForOption(shortId) {
  const res = await graphqlWithAuth(`
    query($id:ID!) {
      node(id: $id) { id }
    }
  `, { id: shortId });
  // If the node is not found, return the original shortId (will fail, but helps debug)
  return res.node?.id || shortId;
}

// Set the Status field to a given option name (e.g., 'Sprint', 'Done')
async function setStatus(itemId, statusName) {
  const projectRes = await graphqlWithAuth(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  const fields = projectRes.node.fields.nodes;
  const statusField = fields.find(f => f.name && f.name.trim().toLowerCase() === 'status' && f.options);
  if (!statusField) throw new Error('Could not find a Status field');
  const statusOption = statusField.options.find(o => o.name.toLowerCase() === statusName.toLowerCase());
  if (!statusOption) throw new Error(`Could not find a Status option named '${statusName}'`);
  // Debug: print the status option id and its type
  console.log(`Setting Status field: option '${statusName}' with id:`, statusOption.id, 'type:', typeof statusOption.id);
  // Debug: print the full status field object as well
  console.log('Status field object:', JSON.stringify(statusField, null, 2));
  // Debug: print the full status option object
  console.log('Status option object:', JSON.stringify(statusOption, null, 2));
  // Fetch the global node ID for the option
  const globalOptionId = await getGlobalNodeIdForOption(statusOption.id);
  console.log('Using global node ID for status option:', globalOptionId);
  await graphqlWithAuth(`
    mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $singleSelectOptionId:ID!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $singleSelectOptionId }
      }) { projectV2Item { id } }
    }
  `, {
    projectId: PROJECT_ID,
    itemId,
    fieldId: statusField.id,
    singleSelectOptionId: globalOptionId
  });
}

// Set the Sprint field to a value (single-select, iteration, or text)
async function setSprintField(itemId, sprintValue) {
  const projectRes = await graphqlWithAuth(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
              ... on ProjectV2IterationField {
                id
                name
                configuration { iterations { id title startDate } }
              }
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  const fields = projectRes.node.fields.nodes;
  // Find the Sprint field (case-insensitive)
  const sprintField = fields.find(f => f.name && f.name.trim().toLowerCase() === 'sprint');
  if (!sprintField) throw new Error('Could not find a Sprint field');

  // If single-select, find the matching option
  if (sprintField.options) {
    let option = sprintField.options.find(o => o.name === sprintValue);
    if (!option) throw new Error(`Could not find Sprint option '${sprintValue}'`);
    await graphqlWithAuth(`
      mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $singleSelectOptionId:ID!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $singleSelectOptionId }
        }) { projectV2Item { id } }
      }
    `, {
      projectId: PROJECT_ID,
      itemId,
      fieldId: sprintField.id,
      singleSelectOptionId: option.id
    });
    return;
  }
  // If iteration, find the current iteration (by title or date)
  if (sprintField.configuration && sprintField.configuration.iterations) {
    let iter = sprintField.configuration.iterations.find(i => i.title === sprintValue);
    if (!iter) throw new Error(`Could not find Sprint iteration '${sprintValue}'`);
    await graphqlWithAuth(`
      mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $iterationId:ID!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { iterationId: $iterationId }
        }) { projectV2Item { id } }
      }
    `, {
      projectId: PROJECT_ID,
      itemId,
      fieldId: sprintField.id,
      iterationId: iter.id
    });
    return;
  }
  // If text field, set as text
  await graphqlWithAuth(`
    mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $value:String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { text: $value }
      }) { projectV2Item { id } }
    }
  `, {
    projectId: PROJECT_ID,
    itemId,
    fieldId: sprintField.id,
    value: sprintValue
  });
}

// Set the Sprint field to the current sprint iteration
async function setSprintIterationField(itemId) {
  const { fieldId, iterationId, title } = await getCurrentSprintIteration();
  await graphqlWithAuth(`
    mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $iterationId:ID!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { iterationId: $iterationId }
      }) { projectV2Item { id } }
  `, {
    projectId: PROJECT_ID,
    itemId,
    fieldId,
    iterationId
  });
  console.log(`  Assigned to current sprint: ${title}`);
}

// Helper: assign PR to author and add to project, assign to current sprint
async function processRepo(repo) {
  const [owner, name] = repo.split('/');
  // Get open and closed PRs, then filter by author in JS
  const prsRes = await graphqlWithAuth(`
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 50, states: [OPEN, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            id
            number
            title
            state
            author { login }
          }
        }
      }
    }
  `, { owner, name });
  for (const pr of prsRes.repository.pullRequests.nodes.filter(pr => pr.author && pr.author.login === GITHUB_AUTHOR)) {
    // Add PR to project
    const itemId = await addToProject(pr.id);
    // Assign PR to author in project
    await graphqlWithAuth(`
      mutation($itemId:ID!, $assignee:String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: "assignees",
          value: { users: [$assignee] }
        }) { projectV2Item { id } }
      }
    `, { projectId: PROJECT_ID, itemId, assignee: GITHUB_AUTHOR });
    // Assign to current sprint (iteration field)
    await setSprintIterationField(itemId);
    console.log(`  PR #${pr.number} assigned to ${GITHUB_AUTHOR} and current sprint.`);
  }
}

(async () => {
  const project = await getProjectAndFields(ORG, PROJECT_NUMBER);
  if (!project) {
    throw new Error(`Could not resolve to a ProjectV2 with the number ${PROJECT_NUMBER} in org ${ORG}. Check that the project number and org are correct, and that your token has access.`);
  }
  const PROJECT_ID = project.id;
  console.log(`\n---\nSyncing to GitHub Project: '${project.title}' (ID: ${PROJECT_ID}) in org: '${ORG}'\n---`);
  let hadError = false;
  for (const repo of repos) {
    try {
      const fullRepo = withOrg(repo, ORG);
      await processRepo(fullRepo);
    } catch (e) {
      console.error(`Error processing ${repo}:`, e.message);
      hadError = true;
    }
  }
  if (hadError) {
    console.error("\nOne or more repositories failed to sync. Exiting with error status.");
    process.exit(1);
  }
})();
