import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const baseSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

export const collections = {
  spec: defineCollection({
    loader: glob({ pattern: '**/*.md', base: '../docs/spec' }),
    schema: baseSchema,
  }),
  'user-guide': defineCollection({
    loader: glob({ pattern: '**/*.md', base: '../docs/user-guide' }),
    schema: baseSchema,
  }),
  conventions: defineCollection({
    loader: glob({ pattern: '**/*.md', base: '../docs/conventions' }),
    schema: baseSchema,
  }),
  setup: defineCollection({
    loader: glob({ pattern: '**/*.md', base: '../docs/setup' }),
    schema: baseSchema,
  }),
};
