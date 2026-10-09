import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readTaskQueryState, syncTaskQueryState } from '../frontend/src/features/tasks/task-query-params.js';
import { countAdvancedFilters, loadSavedViews, snapshotView, storeSavedViews, viewPatch } from '../frontend/src/features/tasks/task-views.js';
import { decodeFilterExpression, encodeFilterExpression } from '../frontend/src/features/tasks/advanced-filter.js';

const browser = new Window({ url: 'http://localhost/tasks?status=em_revisao&priority=1&page=4&pageSize=50' });
(globalThis as any).window = browser;
(globalThis as any).localStorage = browser.localStorage;

after(() => browser.happyDOM.abort());

test('legacy task filter query params remain readable and advanced expressions round-trip as versioned URLs and saved views', () => {
  const state = readTaskQueryState();
  assert.equal(state.status, 'em_revisao');
  assert.equal(state.priority, '1');
  assert.equal(state.pageSize, 50);
  assert.equal(state.page, 1, 'cursor pagination starts at its first page after reading a legacy page number');
  assert.equal(countAdvancedFilters(state), 1, 'counts the hidden priority filter but not visible status/search controls');

  state.expression = { kind: 'group', operator: 'OR', children: [
    { kind: 'condition', field: 'status', operator: 'is', value: 'em_revisao' },
    { kind: 'group', operator: 'AND', children: [
      { kind: 'condition', field: 'unread', operator: 'is', value: true },
      { kind: 'condition', field: 'priority', operator: 'gte', value: 4 }
    ] }
  ] };
  assert.equal(countAdvancedFilters({ ...state, search: 'cutover', area: 'backend', type: 'fix', flag: 'unread' }), 4,
    'counts each advanced rule while excluding quick search, area, type, and attention filters');
  syncTaskQueryState(state);
  const params = new URLSearchParams(browser.location.search);
  assert.match(params.get('filter') ?? '', /^v1\./);
  assert.equal(params.has('page'), false);
  assert.equal(readTaskQueryState(browser.location.search).expression.children.length, 2);
  const legacyExact = encodeFilterExpression({ kind: 'group', operator: 'AND', children: [{ kind: 'condition', field: 'name', operator: 'equals', value: 'Cutover alpha' }] });
  assert.equal(decodeFilterExpression(legacyExact).children[0].kind === 'condition' ? decodeFilterExpression(legacyExact).children[0].operator : '', 'exact');

  const saved = snapshotView('Review and unread', state);
  storeSavedViews('project-filter-test', [saved]);
  assert.deepEqual(loadSavedViews('project-filter-test')[0].state.expression, state.expression);
  browser.localStorage.setItem('project-tasks.views.project-filter-legacy', JSON.stringify([{ id: 'legacy', label: 'Legacy', state: { status: 'em_revisao' } }]));
  const legacy = loadSavedViews('project-filter-legacy')[0];
  assert.equal(legacy.state.status, 'em_revisao');
  assert.equal(viewPatch(legacy).expression.children.length, 0);
});
