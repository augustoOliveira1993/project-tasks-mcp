import { operationId, request } from '../../api';

export type FeatureDraft = { name: string; objective: string; context: string; acceptance: string[] };
export type FeatureRecord = { _id: string; name: string; objective: string; context: string; acceptance: string[] };

export function featureDataFromDraft(draft: FeatureDraft) {
  const data = {
    name: draft.name.trim(),
    objective: draft.objective.trim(),
    context: draft.context.trim(),
    acceptance: draft.acceptance.map(item => item.trim()).filter(Boolean)
  };
  if (!data.name || !data.objective || !data.context) throw new Error('Preencha nome, objetivo e contexto da feature.');
  if (!data.acceptance.length) throw new Error('Informe ao menos um critério de aceite.');
  return data;
}

export function submitNewFeature(token: string, projectId: string, draft: FeatureDraft) {
  return request<FeatureRecord>(token, '/admin/features', {
    body: { operationId: operationId(), projectId, data: featureDataFromDraft(draft) }
  });
}
