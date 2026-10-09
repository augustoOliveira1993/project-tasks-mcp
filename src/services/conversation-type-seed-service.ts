import type { ClientSession } from 'mongoose';
import { ConversationType } from '../models.js';
import { conversationTypeSeedTemplates, seededConversationTypeId } from '../conversation-workflows.js';

function nameKey(name: string) {
  return name.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
}

export type ConversationTypeSeedPlanItem = {
  key: string;
  name: string;
  typeId: string;
  action: 'create' | 'already_seeded' | 'reuse_existing' | 'archived';
};

export async function planConversationTypeSeeds(projectId: string, session?: ClientSession): Promise<ConversationTypeSeedPlanItem[]> {
  const typeIds = conversationTypeSeedTemplates.map(template => seededConversationTypeId(projectId, template.key));
  const nameKeys = conversationTypeSeedTemplates.map(template => nameKey(template.name));
  let query = ConversationType.find({
    projectId,
    $or: [{ _id: { $in: typeIds } }, { nameKey: { $in: nameKeys } }]
  }).select('_id name nameKey archived');
  if (session) query = query.session(session) as typeof query;
  const existing = await query.lean();
  const byId = new Map(existing.map(item => [item._id, item]));
  const activeByName = new Map(existing.filter(item => !item.archived).map(item => [item.nameKey, item]));

  return conversationTypeSeedTemplates.map(template => {
    const typeId = seededConversationTypeId(projectId, template.key);
    const seeded = byId.get(typeId);
    const activeName = activeByName.get(nameKey(template.name));
    return {
      key: template.key,
      name: template.name,
      typeId,
      action: seeded && !seeded.archived
        ? 'already_seeded'
        : (activeName ? 'reuse_existing' : (seeded?.archived ? 'archived' : 'create'))
    };
  });
}

/** Adds missing built-in workflow templates without changing custom or archived types. */
export async function seedConversationTypes(projectId: string, session: ClientSession) {
  const plan = await planConversationTypeSeeds(projectId, session);
  const activeByName = await ConversationType.find({
    projectId,
    archived: false,
    nameKey: { $in: conversationTypeSeedTemplates.map(template => nameKey(template.name)) }
  }).session(session).lean();
  const existingIds = plan.map(item => item.typeId);
  const existingSeeds = await ConversationType.find({ projectId, _id: { $in: existingIds } }).session(session).lean();
  const activeBySeedName = new Map(activeByName.map(item => [item.nameKey, item]));
  const byId = new Map(existingSeeds.map(item => [item._id, item]));
  const workflows = new Map<string, any>();
  const created: string[] = [];

  for (const template of conversationTypeSeedTemplates) {
    const typeId = seededConversationTypeId(projectId, template.key);
    const seeded = byId.get(typeId);
    const key = nameKey(template.name);
    if (seeded) {
      if (!seeded.archived) workflows.set(template.key, seeded);
      else {
        const existingByName = activeBySeedName.get(key);
        if (existingByName) workflows.set(template.key, existingByName);
      }
      continue;
    }

    const existingByName = activeBySeedName.get(key);
    if (existingByName) {
      workflows.set(template.key, existingByName);
      continue;
    }

    const type = new ConversationType({
      _id: typeId,
      projectId,
      name: template.name,
      nameKey: key,
      description: template.description,
      stages: template.stages
    });
    await type.save({ session });
    workflows.set(template.key, type.toObject());
    activeBySeedName.set(key, type.toObject());
    created.push(typeId);
  }

  return { workflows, created, plan };
}
