import assert from 'node:assert/strict';
import test from 'node:test';
import { getSelectedVisibleItems, paginateItems } from '../frontend/src/features/tasks/task-pagination.ts';

const items = Array.from({ length: 23 }, (_, index) => ({ _id: String(index + 1) }));

test('paginates the filtered list and reports the visible range', () => {
  const result = paginateItems(items, 2, 10);

  assert.equal(result.page, 2);
  assert.equal(result.pageCount, 3);
  assert.equal(result.firstItem, 11);
  assert.equal(result.lastItem, 20);
  assert.deepEqual(result.items.map(item => item._id), Array.from({ length: 10 }, (_, index) => String(index + 11)));
});

test('clamps a stale page after filters reduce the result set and handles no results', () => {
  const filtered = items.slice(0, 4);
  const result = paginateItems(filtered, 6, 2);
  const empty = paginateItems([], 6, 2);

  assert.equal(result.page, 2);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.items.map(item => item._id), ['3', '4']);
  assert.deepEqual([empty.page, empty.pageCount, empty.firstItem, empty.lastItem], [1, 1, 0, 0]);
});

test('bulk selection contains only eligible selected items on the visible page', () => {
  const visible = [
    { _id: '11', status: 'em_revisao' },
    { _id: '12', status: 'pendente' },
    { _id: '13', status: 'concluida' }
  ];
  const selectedIds = ['1', '11', '12', '13'];
  const result = getSelectedVisibleItems(visible, selectedIds, item => item.status === 'em_revisao' || item.status === 'concluida');

  assert.deepEqual(result.map(item => item._id), ['11', '13']);
});
