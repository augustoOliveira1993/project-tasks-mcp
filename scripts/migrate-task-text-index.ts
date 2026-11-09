import mongoose from 'mongoose';

const target = process.argv[2];
if (target !== 'expand' && target !== 'restore') throw new Error('Use expand ou restore.');
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) throw new Error('Defina MONGODB_URI para migrar o índice de busca de tarefas.');

mongoose.set('autoIndex', false);
const { migrateTaskTextIndex } = await import('../src/db.js');
await mongoose.connect(mongoUri);
try {
  await migrateTaskTextIndex(target === 'expand' ? 'expanded' : 'legacy');
  console.log(`Índice de busca de tarefas: ${target}.`);
} finally {
  await mongoose.disconnect();
}
