import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AgentRegisterSchema,
  AgentVerifySchema,
  TaskCreateSchema,
  TaskSubmitSchema,
  BidCreateSchema,
  RatingCreateSchema,
  TaskListQuerySchema,
} from '../src/schemas.ts';

describe('AgentRegisterSchema', () => {
  it('accepts valid registration', () => {
    const result = AgentRegisterSchema.safeParse({
      publicKey: 'abc123base64encodedkey',
      displayName: 'TestAgent',
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      skills: [],
    });
    assert.equal(result.success, true);
  });

  it('rejects missing public key', () => {
    const result = AgentRegisterSchema.safeParse({
      displayName: 'TestAgent',
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    });
    assert.equal(result.success, false);
  });

  it('rejects invalid wallet address', () => {
    const result = AgentRegisterSchema.safeParse({
      publicKey: 'abc123',
      displayName: 'TestAgent',
      walletAddress: 'not-an-address',
    });
    assert.equal(result.success, false);
  });

  it('validates skill structure', () => {
    const result = AgentRegisterSchema.safeParse({
      publicKey: 'abc123',
      displayName: 'TestAgent',
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      skills: [{
        skillId: 'code-review',
        skillName: 'Code Review',
        description: 'Reviews code for quality',
        category: 'development',
        basePrice: '5000000',
      }],
    });
    assert.equal(result.success, true);
  });
});

describe('AgentVerifySchema', () => {
  it('accepts valid verification', () => {
    const result = AgentVerifySchema.safeParse({
      publicKey: 'abc123',
      challenge: 'nonce123',
      signature: 'sig456',
    });
    assert.equal(result.success, true);
  });

  it('rejects empty fields', () => {
    assert.equal(AgentVerifySchema.safeParse({ publicKey: '', challenge: 'x', signature: 'x' }).success, false);
    assert.equal(AgentVerifySchema.safeParse({ publicKey: 'x', challenge: '', signature: 'x' }).success, false);
    assert.equal(AgentVerifySchema.safeParse({ publicKey: 'x', challenge: 'x', signature: '' }).success, false);
  });
});

describe('TaskCreateSchema', () => {
  it('accepts valid task', () => {
    const result = TaskCreateSchema.safeParse({
      title: 'Build a landing page',
      description: 'Create a responsive landing page with Tailwind CSS',
      skillRequirements: ['web-design', 'tailwind'],
      budgetMax: '10000000',
    });
    assert.equal(result.success, true);
  });

  it('rejects empty skill requirements', () => {
    const result = TaskCreateSchema.safeParse({
      title: 'Test',
      description: 'Test',
      skillRequirements: [],
      budgetMax: '1000000',
    });
    assert.equal(result.success, false);
  });

  it('rejects missing budget', () => {
    const result = TaskCreateSchema.safeParse({
      title: 'Test',
      description: 'Test',
      skillRequirements: ['test'],
    });
    assert.equal(result.success, false);
  });

  it('validates matching mode enum', () => {
    const valid = TaskCreateSchema.safeParse({
      title: 'Test',
      description: 'Test',
      skillRequirements: ['test'],
      budgetMax: '1000000',
      matchingMode: 'direct',
    });
    assert.equal(valid.success, true);

    const invalid = TaskCreateSchema.safeParse({
      title: 'Test',
      description: 'Test',
      skillRequirements: ['test'],
      budgetMax: '1000000',
      matchingMode: 'invalid',
    });
    assert.equal(invalid.success, false);
  });
});

describe('TaskSubmitSchema', () => {
  it('accepts valid submission', () => {
    const result = TaskSubmitSchema.safeParse({
      artifacts: [{ type: 'code', content: 'console.log("hello")' }],
    });
    assert.equal(result.success, true);
  });

  it('rejects empty artifacts', () => {
    const result = TaskSubmitSchema.safeParse({ artifacts: [] });
    assert.equal(result.success, false);
  });
});

describe('BidCreateSchema', () => {
  it('accepts valid bid', () => {
    const result = BidCreateSchema.safeParse({
      proposedPrice: '5000000',
      confidenceScore: 0.95,
      proposal: 'I can do this efficiently',
    });
    assert.equal(result.success, true);
  });

  it('rejects confidence score out of range', () => {
    assert.equal(BidCreateSchema.safeParse({ proposedPrice: '100', confidenceScore: 1.5 }).success, false);
    assert.equal(BidCreateSchema.safeParse({ proposedPrice: '100', confidenceScore: -0.1 }).success, false);
  });
});

describe('RatingCreateSchema', () => {
  it('accepts valid rating', () => {
    const result = RatingCreateSchema.safeParse({
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      rateeId: '550e8400-e29b-41d4-a716-446655440001',
      qualityScore: 0.9,
      speedScore: 0.8,
      communicationScore: 0.85,
    });
    assert.equal(result.success, true);
  });

  it('rejects scores outside 0-1 range', () => {
    const result = RatingCreateSchema.safeParse({
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      rateeId: '550e8400-e29b-41d4-a716-446655440001',
      qualityScore: 1.5,
    });
    assert.equal(result.success, false);
  });

  it('rejects non-UUID task/ratee IDs', () => {
    const result = RatingCreateSchema.safeParse({
      taskId: 'not-a-uuid',
      rateeId: '550e8400-e29b-41d4-a716-446655440001',
      qualityScore: 0.5,
    });
    assert.equal(result.success, false);
  });
});

describe('TaskListQuerySchema', () => {
  it('applies defaults for limit and offset', () => {
    const result = TaskListQuerySchema.safeParse({});
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.limit, 20);
      assert.equal(result.data.offset, 0);
    }
  });

  it('coerces string numbers', () => {
    const result = TaskListQuerySchema.safeParse({ limit: '50', offset: '10' });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.limit, 50);
      assert.equal(result.data.offset, 10);
    }
  });

  it('rejects limit > 100', () => {
    const result = TaskListQuerySchema.safeParse({ limit: '200' });
    assert.equal(result.success, false);
  });
});
