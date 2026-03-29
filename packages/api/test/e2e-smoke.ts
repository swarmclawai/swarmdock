/**
 * E2E Smoke Test for SwarmDock
 * Tests the full flow: register 2 agents → create task → bid → accept → start → submit → approve
 */
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
const { encodeBase64 } = tweetnaclUtil;

const API_URL = process.env.SWARMDOCK_API_URL ?? 'https://swarmdock-api.onrender.com';

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json();
  if (!res.ok && res.status !== 201) {
    console.error(`${options.method ?? 'GET'} ${path} → ${res.status}:`, data);
    throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function registerAgent(name: string, skill: string) {
  const keyPair = nacl.sign.keyPair();
  const publicKey = encodeBase64(keyPair.publicKey);
  const secretKey = keyPair.secretKey;

  // Step 1: Register
  const reg = await request('/api/v1/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      publicKey,
      displayName: name,
      description: `Test agent: ${name}`,
      framework: 'test',
      walletAddress: '0x' + Buffer.from(nacl.randomBytes(20)).toString('hex'),
      skills: [{
        skillId: skill,
        skillName: skill.replace('-', ' '),
        description: `Specializes in ${skill}`,
        category: 'test',
        basePrice: '1000000', // $1.00 USDC
      }],
    }),
  });

  console.log(`  Registered ${name} → agentId: ${reg.agentId}`);

  // Step 2: Verify (sign challenge)
  const messageBytes = new TextEncoder().encode(reg.challenge);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  const signatureBase64 = encodeBase64(signature);

  const verify = await request('/api/v1/agents/verify', {
    method: 'POST',
    body: JSON.stringify({
      publicKey,
      challenge: reg.challenge,
      signature: signatureBase64,
    }),
  });

  console.log(`  Verified ${name} → DID: ${verify.agent.did}`);
  return { agentId: reg.agentId, token: verify.token, did: verify.agent.did };
}

async function main() {
  console.log(`\n=== SwarmDock E2E Smoke Test ===`);
  console.log(`API: ${API_URL}\n`);

  // Health check
  console.log('1. Health check...');
  const health = await request('/api/v1/health');
  console.log(`  Status: ${health.status}, DB: ${health.database}\n`);

  // Register Agent A (requester)
  console.log('2. Register Agent A (requester)...');
  const agentA = await registerAgent('TestRequester-A', 'task-management');

  // Register Agent B (worker)
  console.log('\n3. Register Agent B (worker)...');
  const agentB = await registerAgent('TestWorker-B', 'web-design');

  // Agent A creates a task
  console.log('\n4. Agent A creates a task...');
  const task = await request('/api/v1/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentA.token}` },
    body: JSON.stringify({
      title: 'Design a test landing page',
      description: 'Create a simple landing page for smoke testing',
      skillRequirements: ['web-design'],
      budgetMax: '5000000', // $5.00
      budgetMin: '1000000', // $1.00
    }),
  });
  console.log(`  Task created: ${task.id} (status: ${task.status})`);

  // Agent B bids on the task
  console.log('\n5. Agent B bids on the task...');
  const bid = await request(`/api/v1/tasks/${task.id}/bids`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentB.token}` },
    body: JSON.stringify({
      proposedPrice: '3000000', // $3.00
      confidenceScore: 0.95,
      proposal: 'I can build this quickly with my web design skills.',
    }),
  });
  console.log(`  Bid submitted: ${bid.id} (price: $${(Number(bid.proposedPrice) / 1e6).toFixed(2)})`);

  // Agent A accepts the bid
  console.log('\n6. Agent A accepts the bid...');
  const accepted = await request(`/api/v1/tasks/${task.id}/bids/${bid.id}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentA.token}` },
  });
  console.log(`  Bid accepted. Task status: ${accepted.task.status}`);

  // Agent B starts work
  console.log('\n7. Agent B starts work...');
  const started = await request(`/api/v1/tasks/${task.id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentB.token}` },
  });
  console.log(`  Work started. Task status: ${started.status}`);

  // Agent B submits results
  console.log('\n8. Agent B submits results...');
  const submitted = await request(`/api/v1/tasks/${task.id}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentB.token}` },
    body: JSON.stringify({
      artifacts: [
        { type: 'text/html', content: '<html><body><h1>Test Landing Page</h1></body></html>' },
        { type: 'application/json', content: { designSystem: 'tailwind', responsive: true } },
      ],
      notes: 'Landing page complete with responsive design.',
    }),
  });
  console.log(`  Results submitted. Task status: ${submitted.status}`);

  // Agent A approves (releases payment)
  console.log('\n9. Agent A approves and releases payment...');
  const completed = await request(`/api/v1/tasks/${task.id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentA.token}` },
  });
  console.log(`  Task completed! Status: ${completed.status}`);
  console.log(`  Release TX: ${completed.releaseTxHash}`);

  // Agent A rates Agent B
  console.log('\n10. Agent A rates Agent B...');
  const rating = await request('/api/v1/ratings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentA.token}` },
    body: JSON.stringify({
      taskId: task.id,
      rateeId: agentB.agentId,
      qualityScore: 5,
      speedScore: 5,
      reliabilityScore: 5,
      comment: 'Excellent work on the landing page!',
    }),
  });
  console.log(`  Rating submitted: ${rating.qualityScore}/5`);

  // Check Agent B balance
  console.log('\n11. Check Agent B balance...');
  const balance = await request(`/api/v1/payments/agents/${agentB.agentId}/balance`, {
    headers: { Authorization: `Bearer ${agentB.token}` },
  });
  console.log(`  Earned: $${(Number(balance.earned) / 1e6).toFixed(2)} USDC`);
  console.log(`  (after 7% platform fee)`);

  // Verify agents list
  console.log('\n12. Verify agents visible...');
  const agents = await request('/api/v1/agents');
  console.log(`  Active agents: ${agents.agents.length}`);

  // Verify tasks list
  console.log('\n13. Verify tasks visible...');
  const tasks = await request('/api/v1/tasks');
  console.log(`  Total tasks: ${tasks.tasks.length}`);

  console.log('\n=== ALL TESTS PASSED ===\n');
}

main().catch((err) => {
  console.error('\n=== TEST FAILED ===');
  console.error(err.message);
  process.exit(1);
});
