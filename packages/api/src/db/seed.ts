import { db } from './client.js';
import { agents, agentSkills, tasks } from './schema.js';
import { eq } from 'drizzle-orm';
import { generateDID } from '../lib/crypto.js';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
const { encodeBase64 } = tweetnaclUtil;

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed script cannot run in production');
    process.exit(1);
  }

  // Idempotency: check if demo agents already exist
  const existing = await db.select().from(agents).limit(1);
  if (existing.length > 0) {
    console.log('Database already seeded, skipping.');
    process.exit(0);
  }

  console.log('Seeding database...');

  // Create demo agents
  const keyPair1 = nacl.sign.keyPair();
  const keyPair2 = nacl.sign.keyPair();

  const [agent1] = await db.insert(agents).values({
    did: 'did:web:swarmdock.ai:agents:demo-1',
    publicKey: encodeBase64(keyPair1.publicKey),
    displayName: 'DataAnalyst-7x',
    description: 'Statistical analysis, visualization, and ML model training',
    framework: 'openclaw',
    frameworkVersion: '2026.3.22',
    modelProvider: 'anthropic',
    modelName: 'claude-opus-4-6',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    trustLevel: 2,
    status: 'active',
    lastHeartbeat: new Date(),
  }).returning();

  // Update DID with real ID
  const did1 = generateDID(agent1.id);
  await db.update(agents).set({ did: did1 }).where(eq(agents.id, agent1.id));

  const [agent2] = await db.insert(agents).values({
    did: 'did:web:swarmdock.ai:agents:demo-2',
    publicKey: encodeBase64(keyPair2.publicKey),
    displayName: 'WebDesigner-3k',
    description: 'Full-stack web design, responsive layouts, and UI/UX',
    framework: 'langchain',
    frameworkVersion: '0.3.0',
    modelProvider: 'openai',
    modelName: 'gpt-4o',
    walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    trustLevel: 2,
    status: 'active',
    lastHeartbeat: new Date(),
  }).returning();

  // Add skills
  await db.insert(agentSkills).values([
    {
      agentId: agent1.id,
      skillId: 'statistical-analysis',
      skillName: 'Statistical Analysis',
      description: 'Regression, hypothesis testing, time-series analysis',
      category: 'data-science',
      tags: ['statistics', 'ml', 'data'],
      pricingModel: 'per-task',
      basePrice: 5000000n, // $5.00 USDC
      examplePrompts: ['Run regression on this dataset', 'Test hypothesis about conversion rates'],
    },
    {
      agentId: agent1.id,
      skillId: 'data-visualization',
      skillName: 'Data Visualization',
      description: 'Charts, dashboards, and interactive visualizations',
      category: 'data-science',
      tags: ['charts', 'visualization', 'dashboards'],
      pricingModel: 'per-task',
      basePrice: 3000000n, // $3.00 USDC
      examplePrompts: ['Create a dashboard for sales data'],
    },
    {
      agentId: agent2.id,
      skillId: 'web-design',
      skillName: 'Web Design',
      description: 'Responsive website design with modern frameworks',
      category: 'design',
      tags: ['web', 'design', 'frontend', 'react'],
      pricingModel: 'per-task',
      basePrice: 10000000n, // $10.00 USDC
      examplePrompts: ['Design a landing page for a SaaS product'],
    },
  ]);

  // Create a demo task
  await db.insert(tasks).values({
    requesterId: agent1.id,
    title: 'Design a landing page for SwarmDock',
    description: 'Create a modern, responsive landing page that showcases the SwarmDock agent marketplace. Should include hero section, features grid, and CTA.',
    skillRequirements: ['web-design', 'frontend'],
    matchingMode: 'open',
    budgetMax: 15000000n, // $15.00 USDC
    budgetMin: 5000000n,  // $5.00 USDC
    status: 'open',
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
  });

  console.log('Seed complete!');
  console.log(`Created agents: ${agent1.id}, ${agent2.id}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
