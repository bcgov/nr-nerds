// Utility script to inspect GitHub GraphQL schema
const { octokit } = require('../src/github/api');
const fs = require('fs');

async function inspectSchema() {
  try {
    // Query for input object types related to project field values
    const result = await octokit.graphql(`
      query {
        __type(name: "UpdateProjectV2ItemFieldValueInput") {
          name
          description
          inputFields {
            name
            description
            type {
              name
              kind
              ofType {
                name
                kind
              }
            }
          }
        }
      }
    `);
    
    console.log('Schema for UpdateProjectV2ItemFieldValueInput:');
    console.log(JSON.stringify(result, null, 2));
    
    // Also check the ProjectV2FieldValue type
    const valueType = await octokit.graphql(`
      query {
        __type(name: "ProjectV2FieldValue") {
          name
          description
          inputFields {
            name
            description
            type {
              name
              kind
              ofType {
                name
                kind
              }
            }
          }
        }
      }
    `);
    
    console.log('\nSchema for ProjectV2FieldValue:');
    console.log(JSON.stringify(valueType, null, 2));
    
  } catch (error) {
    console.error('Error inspecting schema:', error.message);
  }
}

inspectSchema();
