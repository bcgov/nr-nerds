/**
 * @fileoverview JSON Schema for project board sync configuration
 * 
 * @directive Always run schema validation tests after changes:
 * ```bash
 * npm test -- config/loader.test.js
 * ```
 * Schema changes can affect all rule validation.
 */

const schema = {
  type: 'object',
  required: [ 'project', 'automation', 'technical' ],
  properties: {
    project: {
      type: 'object',
      required: [ 'id' ],
      properties: {
        id: { type: 'string' }
      }
    },
    automation: {
      type: 'object',
      required: [ 'user_scope', 'repository_scope' ],
      properties: {
        user_scope: {
          type: 'object',
          required: [ 'monitored_users', 'rules' ],
          properties: {
            monitored_users: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1
            },
            rules: { $ref: '#/definitions/ruleGroups' }
          }
        },
        repository_scope: {
          type: 'object',
          required: [ 'organization', 'repositories', 'rules' ],
          properties: {
            organization: { type: 'string' },
            repositories: {
              type: 'array',
              items: { type: 'string' }
            },
            rules: { $ref: '#/definitions/ruleGroups' }
          }
        }
      }
    },
    technical: {
      type: 'object',
      required: [ 'batch_size', 'batch_delay_seconds', 'update_window_hours', 'optimization' ],
      properties: {
        batch_size: { type: 'integer', minimum: 1 },
        batch_delay_seconds: { type: 'integer', minimum: 0 },
        update_window_hours: { type: 'integer', minimum: 1 },
        optimization: {
          type: 'object',
          required: [ 'skip_unchanged', 'dedup_by_id' ],
          properties: {
            skip_unchanged: { type: 'boolean' },
            dedup_by_id: { type: 'boolean' }
          }
        }
      }
    }
  },
  definitions: {
    ruleGroups: {
      type: 'object',
      properties: {
        board_items: {
          type: 'array',
          items: { $ref: '#/definitions/rule' }
        },
        columns: {
          type: 'array',
          items: {
            allOf: [
              { $ref: '#/definitions/rule' },
              {
                type: 'object',
                properties: {
                  validTransitions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: [ 'from', 'to', 'conditions' ],
                      properties: {
                        from: {
                          oneOf: [
                            { type: 'string' },
                            { type: 'array', items: { type: 'string' } }
                          ]
                        },
                        to: { type: 'string' },
                        conditions: { type: 'array', items: { type: 'string' } }
                      }
                    }
                  }
                }
              }
            ]
          }
        },
        sprints: {
          type: 'array',
          items: { $ref: '#/definitions/rule' }
        },
        linked_issues: {
          type: 'array',
          items: { $ref: '#/definitions/rule' }
        },
        assignees: {
          type: 'array',
          items: { $ref: '#/definitions/rule' }
        }
      }
    },
    rule: {
      type: 'object',
      required: [ 'name', 'trigger', 'action' ],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        trigger: {
          type: 'object',
          required: [ 'type', 'condition' ],
          properties: {
            type: {
              oneOf: [
                { type: 'string', enum: [ 'PullRequest', 'Issue', 'LinkedIssue' ] },
                {
                  type: 'array',
                  items: { type: 'string', enum: [ 'PullRequest', 'Issue', 'LinkedIssue' ] }
                }
              ]
            },
            condition: { type: 'string' },
            stateRequirements: {
              type: 'object',
              properties: {
                column: { type: 'string' },
                sprint: { type: 'string' },
                assignees: {
                  type: 'array',
                  items: { type: 'string' }
                },
                labels: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        },
        action: {
          oneOf: [
            { type: 'string' },
            {
              type: 'array',
              items: { type: 'string' }
            }
          ]
        },
        value: { type: 'string' },
        skip_if: { type: 'string' }
      }
    }
  }
};

module.exports = schema;
