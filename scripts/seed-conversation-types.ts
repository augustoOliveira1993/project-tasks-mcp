import mongoose from 'mongoose';
import { connect, Project } from '../src/db.js';
import { env } from '../src/env.js';
import { planConversationTypeSeeds, seedConversationTypes } from '../src/services/conversation-type-seed-service.js';

const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project-id');
const projectId = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
const allProjects = args.includes('--all-projects');
const apply = args.includes('--apply');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: yarn seed:conversation-types -- --project-id <uuid> [--apply]');
  console.log('       yarn seed:conversation-types -- --all-projects [--apply]');
  console.log('Without --apply, prints a preview. Existing and archived types are preserved.');
  process.exit(0);
}

if (Boolean(projectId) === allProjects) throw new Error('Informe --project-id <uuid> ou --all-projects.');
if (projectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
  throw new Error('--project-id deve ser um UUID válido.');
}
if (args.some(arg => !['--project-id', projectId, '--all-projects', '--apply', '--help', '-h'].includes(arg))) {
  throw new Error('Argumento desconhecido. Use --help para ver a sintaxe.');
}

await connect(env.mongodbUri);
try {
  const projects = projectId
    ? await Project.find({ _id: projectId, archived: false }).select('_id name').lean()
    : await Project.find({ archived: false }).select('_id name').sort({ name: 1, _id: 1 }).lean();
  if (projectId && !projects.length) throw new Error('Projeto ativo não encontrado.');

  const results = [];
  for (const project of projects) {
    const plan = await planConversationTypeSeeds(project._id!);
    const result = apply
      ? await mongoose.connection.transaction(session => seedConversationTypes(project._id!, session))
      : undefined;
    results.push({
      projectId: project._id,
      projectName: project.name,
      created: result?.created.length ?? 0,
      preserved: plan.length - (result?.created.length ?? 0),
      items: plan
    });
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'preview', projects: results }, null, 2));
} finally {
  await mongoose.disconnect();
}
