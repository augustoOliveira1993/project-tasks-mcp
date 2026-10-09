import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { emptyFilterGroup, expressionIsReady, type FilterGroup } from '../frontend/src/features/tasks/advanced-filter.js';
import type { FilterField } from '../frontend/src/features/tasks/advanced-filter.js';

test('advanced filter panel adds, edits, removes rules and prevents applying incomplete values', async () => {
  const browser = new Window({ url: 'http://localhost/tasks' });
  Object.assign(globalThis, { window: browser, document: browser.document, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser.navigator });
  const React = await import('react');
  (globalThis as any).React = React;
  const { createRoot } = await import('react-dom/client');
  const { AdvancedTaskFilterPanel } = await import('../frontend/src/features/tasks/AdvancedTaskFilterPanel.js');
  const container = browser.document.createElement('div');
  browser.document.body.append(container);
  let draft: FilterGroup = emptyFilterGroup();
  let applied = 0;
  function Harness() {
    const [value, setValue] = React.useState<FilterGroup>(emptyFilterGroup());
    draft = value;
    return React.createElement(AdvancedTaskFilterPanel, {
      open: true, draft: value, valid: expressionIsReady(value), setDraft: setValue,
      options: { status: [{ value: 'pendente', label: 'Pendente' }], priority: [{ value: '4', label: 'P1 · Alta' }] },
      close: () => undefined, clear: () => setValue(emptyFilterGroup()), apply: () => { applied++; }
    });
  }
  const root = createRoot(container);
  const act = React.act;
  const click = async (button: HTMLButtonElement) => act(async () => { button.dispatchEvent(new browser.MouseEvent('click', { bubbles: true })); });
  const select = async (element: HTMLSelectElement, value: string) => act(async () => { element.value = value; element.dispatchEvent(new browser.Event('change', { bubbles: true })); });
  await act(async () => root.render(React.createElement(Harness)));
  const conditionButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Condição'))!;
  await click(conditionButton as HTMLButtonElement);
  assert.equal(draft.children.length, 1);
  assert.equal(container.querySelector<HTMLButtonElement>('button[disabled]')?.textContent?.includes('Aplicar'), true);

  const labels = Array.from(container.querySelectorAll('label'));
  const fieldSelect = labels.find(label => label.textContent?.startsWith('Campo'))!.querySelector('select')!;
  await select(fieldSelect, 'name');
  const operatorSelect = labels.find(label => label.textContent?.startsWith('Operador'))!.querySelector('select')!;
  const nameOperators = Array.from(operatorSelect.options).map(option => option.textContent);
  assert.ok(nameOperators.includes('contém'));
  assert.ok(nameOperators.includes('não contém'));
  assert.ok(nameOperators.includes('exatamente igual a'));
  assert.ok(nameOperators.includes('começa com'));
  assert.ok(nameOperators.includes('termina com'));
  await select(operatorSelect, 'not');
  const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="Valor do filtro"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(nameInput, 'Cutover');
    nameInput.dispatchEvent(new browser.Event('input', { bubbles: true }));
  });
  assert.deepEqual(draft.children[0], { kind: 'condition', field: 'name' as FilterField, operator: 'not', value: 'Cutover' });

  await select(fieldSelect, 'priority');
  await select(operatorSelect, 'gte');
  const valueInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(valueInput, '4');
    valueInput.dispatchEvent(new browser.Event('input', { bubbles: true }));
  });
  assert.deepEqual(draft.children[0], { kind: 'condition', field: 'priority' as FilterField, operator: 'gte', value: 4 });
  assert.equal(container.querySelector<HTMLButtonElement>('button[disabled]'), null);

  await select(operatorSelect, 'between');
  const bounds = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));
  assert.equal(bounds.length, 2);
  assert.ok(container.querySelector<HTMLButtonElement>('button[disabled]'), 'both range values are required before applying');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(bounds[0], '3');
    bounds[0].dispatchEvent(new browser.Event('input', { bubbles: true }));
  });
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(container.querySelectorAll<HTMLInputElement>('input[type="number"]')[1], '5');
    container.querySelectorAll<HTMLInputElement>('input[type="number"]')[1].dispatchEvent(new browser.Event('input', { bubbles: true }));
  });
  assert.deepEqual(draft.children[0], { kind: 'condition', field: 'priority' as FilterField, operator: 'between', value: [3, 5] });
  assert.equal(container.querySelector<HTMLButtonElement>('button[disabled]'), null);

  const removeCondition = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Remover')!;
  await click(removeCondition as HTMLButtonElement);
  assert.equal(draft.children.length, 0);
  const groupButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Grupo'))!;
  await click(groupButton as HTMLButtonElement);
  assert.equal(draft.children[0].kind, 'group');
  const removeGroup = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Remover grupo'))!;
  await click(removeGroup as HTMLButtonElement);
  assert.equal(draft.children.length, 0);
  const applyButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Aplicar filtros'))!;
  await click(applyButton as HTMLButtonElement);
  assert.equal(applied, 1);
  assert.match(container.querySelector('[role="dialog"]')!.className, /max-\[760px\]:w-full/);
  await act(async () => root.unmount());
  await browser.happyDOM.abort();
});
