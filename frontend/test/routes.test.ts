import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationIdFromSearch, pathForRoute, projectIdFromSearch, routeFromPath, routeUrl, tabForRoute } from '../src/route-state.js';

test('resolve páginas navegáveis e preserva o ponto de entrada atual', () => {
  assert.equal(routeFromPath('/projects'), 'projects');
  assert.equal(routeFromPath('/tasks'), 'tasks');
  assert.equal(routeFromPath('/conversations'), 'conversations');
  assert.equal(routeFromPath('/activity'), 'activity');
  assert.equal(routeFromPath('/settings'), 'settings');
  assert.equal(routeFromPath('/help'), 'help');
  assert.equal(routeFromPath('/admin/'), 'tasks');
  assert.equal(tabForRoute('conversations'), 'chat');
  assert.equal(tabForRoute('settings'), 'admin');
  assert.equal(pathForRoute('projects'), '/projects');
  assert.equal(projectIdFromSearch('?projectId=project-1&featureId=feature-1'), 'project-1');
  assert.equal(projectIdFromSearch('?featureId=feature-1'), '');
  assert.equal(conversationIdFromSearch('?projectId=project-1&conversationId=conversation-1'), 'conversation-1');
});

test('deep links mantêm projectId e featureId, e trocar projeto descarta filtros da seleção anterior', () => {
  assert.equal(routeUrl('tasks', '?projectId=project-1&featureId=feature-1&status=em_execucao', 'project-1'), '/tasks?projectId=project-1&featureId=feature-1&status=em_execucao');
  assert.equal(routeUrl('tasks', '?projectId=project-1&featureId=feature-1&status=em_execucao', 'project-2', false), '/tasks?projectId=project-2');
  assert.equal(routeUrl('conversations', '?projectId=project-1&featureId=feature-1', 'project-1'), '/conversations?projectId=project-1&featureId=feature-1');
  assert.equal(routeUrl('conversations', '?projectId=project-1&conversationId=conversation-1', 'project-1'), '/conversations?projectId=project-1&conversationId=conversation-1');
});

test('cada cadastro tem a própria rota e entrada no menu', async () => {
  const { catalogSectionForRoute, routeForCatalogSection, isCatalogRoute } = await import('../src/route-state.js');
  assert.equal(routeFromPath('/catalogs/responsibles'), 'catalogResponsibles');
  assert.equal(pathForRoute('catalogResponsibles'), '/catalogs/responsibles');
  assert.equal(isCatalogRoute('catalogResponsibles'), true);
  assert.equal(catalogSectionForRoute('catalogResponsibles'), 'responsibles');
  assert.equal(catalogSectionForRoute('catalogs'), 'projects');
  for (const section of ['projects', 'features', 'tasks', 'responsibles'] as const) assert.equal(catalogSectionForRoute(routeForCatalogSection(section)), section);
  assert.equal(tabForRoute('catalogResponsibles'), 'catalogs');
});

test('página dedicada da tarefa tem rota /tasks/:id e preserva o projeto', async () => {
  const { taskIdFromPath, taskPageUrl } = await import('../src/route-state.js');
  assert.equal(routeFromPath('/tasks/task-1'), 'task');
  assert.equal(routeFromPath('/tasks/task-1/'), 'task');
  assert.equal(routeFromPath('/tasks'), 'tasks');
  assert.equal(taskIdFromPath('/tasks/task%201'), 'task 1');
  assert.equal(taskIdFromPath('/tasks'), '');
  assert.equal(taskIdFromPath('/tasks/a/b'), '');
  assert.equal(tabForRoute('task'), 'tasks');
  assert.equal(pathForRoute('task'), '/tasks');
  assert.equal(taskPageUrl('project-1', 'task 1'), '/tasks/task%201?projectId=project-1');
  assert.equal(taskPageUrl('', 'task-1'), '/tasks/task-1');
});
