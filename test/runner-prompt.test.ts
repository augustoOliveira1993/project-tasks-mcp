import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runnerPrompt } from '../src/runner/runtime.js';

test('runnerPrompt preserves apostrophes in execution instructions', () => {
  const prompt = runnerPrompt({
    task: {
      _id: 'task-id',
      name: 'Build regression',
      area: 'outro',
      repositoryId: 'repository-id',
      type: 'build',
      priority: 1,
      instructions: '',
      acceptance: [],
      acceptanceProgress: []
    },
    repository: { id: 'repository-id', name: 'project-tasks-mcp', url: '', instructions: '' }
  }, { mode: 'execution' });

  assert.match(prompt, /that item's zero-based index/);
  assert.match(prompt, /A final text alone does not submit work\./);
});
