import { PRICING_MODEL } from './constants.js';

export interface SkillTemplate {
  skillId: string;
  skillName: string;
  description: string;
  category: string;
  tags: string[];
  pricingModel: string;
  basePrice: string;
  examplePrompts: string[];
}

const templates: Record<string, SkillTemplate> = {
  'data-analysis': {
    skillId: 'data-analysis',
    skillName: 'Data Analysis',
    description: 'Statistical analysis, data visualization, trend detection, and ML model building from structured and unstructured datasets.',
    category: 'data-science',
    tags: ['statistics', 'ml', 'visualization', 'pandas', 'data'],
    pricingModel: PRICING_MODEL.PER_TASK,
    basePrice: '5000000',
    examplePrompts: [
      'Analyze this CSV for trends and anomalies',
      'Build a regression model for sales forecasting',
      'Calculate correlation between user engagement metrics',
      'Create a visualization dashboard from this dataset',
      'Run A/B test analysis on these experiment results',
    ],
  },
  'coding': {
    skillId: 'coding',
    skillName: 'Software Development',
    description: 'Write, review, debug, and refactor code across multiple languages and frameworks. Full-stack development capability.',
    category: 'engineering',
    tags: ['code', 'development', 'debugging', 'review', 'full-stack'],
    pricingModel: PRICING_MODEL.PER_TASK,
    basePrice: '10000000',
    examplePrompts: [
      'Implement a REST API endpoint with authentication',
      'Debug this failing unit test and fix the root cause',
      'Refactor this module to use the repository pattern',
      'Write a TypeScript utility for parsing CSV files',
      'Review this pull request for security vulnerabilities',
    ],
  },
  'content-writing': {
    skillId: 'content-writing',
    skillName: 'Content Writing',
    description: 'Create articles, documentation, marketing copy, technical writing, and other text content with SEO awareness.',
    category: 'content',
    tags: ['writing', 'copywriting', 'documentation', 'seo', 'articles'],
    pricingModel: PRICING_MODEL.PER_TASK,
    basePrice: '3000000',
    examplePrompts: [
      'Write a blog post about the benefits of microservices',
      'Create API documentation for this endpoint',
      'Draft a product launch announcement email',
      'Write a technical tutorial for setting up CI/CD',
      'Create marketing copy for a SaaS landing page',
    ],
  },
  'research': {
    skillId: 'research',
    skillName: 'Research & Synthesis',
    description: 'Web research, literature review, competitive analysis, and synthesis of findings into structured reports.',
    category: 'research',
    tags: ['research', 'analysis', 'synthesis', 'competitive-analysis', 'reports'],
    pricingModel: PRICING_MODEL.PER_TASK,
    basePrice: '4000000',
    examplePrompts: [
      'Research the top 5 competitors in the AI agent space',
      'Summarize recent papers on retrieval-augmented generation',
      'Compile a market analysis for decentralized compute',
      'Find and compare pricing models for API marketplaces',
      'Create a technology landscape report for LLM frameworks',
    ],
  },
  'web-development': {
    skillId: 'web-development',
    skillName: 'Web Development',
    description: 'Build and maintain web applications including frontend UI, backend services, databases, and deployment.',
    category: 'engineering',
    tags: ['web', 'frontend', 'backend', 'react', 'nextjs', 'html', 'css'],
    pricingModel: PRICING_MODEL.PER_TASK,
    basePrice: '12000000',
    examplePrompts: [
      'Build a responsive dashboard page with React',
      'Create a Next.js API route with database integration',
      'Implement OAuth login flow with Google and GitHub',
      'Set up a PostgreSQL schema with Drizzle ORM',
      'Deploy a containerized app to Render with CI/CD',
    ],
  },
  'code-review': {
    skillId: 'code-review',
    skillName: 'Code Review',
    description: 'Review code for bugs, security vulnerabilities, performance issues, and adherence to best practices.',
    category: 'engineering',
    tags: ['review', 'security', 'quality', 'best-practices', 'audit'],
    pricingModel: PRICING_MODEL.PER_TASK,
    basePrice: '6000000',
    examplePrompts: [
      'Review this PR for security vulnerabilities',
      'Audit this authentication module for OWASP top 10',
      'Check this database query for N+1 problems',
      'Review this React component for performance issues',
      'Evaluate this API design against REST best practices',
    ],
  },
};

export const SkillTemplates = {
  /** Return all available skill templates */
  list(): SkillTemplate[] {
    return Object.values(templates);
  },

  /** Get a single template by skill ID, or undefined if not found */
  get(id: string): SkillTemplate | undefined {
    return templates[id];
  },

  /** Return the list of unique categories across all templates */
  categories(): string[] {
    const cats = new Set<string>();
    for (const t of Object.values(templates)) {
      cats.add(t.category);
    }
    return [...cats];
  },

  /** Fuzzy search templates by matching query against name, description, category, and tags */
  search(query: string): SkillTemplate[] {
    const q = query.toLowerCase();
    return Object.values(templates).filter((t) => {
      return (
        t.skillName.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  },

  /** Return all template IDs */
  ids(): string[] {
    return Object.keys(templates);
  },
};
