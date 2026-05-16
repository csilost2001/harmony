import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import pagefind from 'astro-pagefind';
import rehypeMermaid from 'rehype-mermaid';

export default defineConfig({
  site: 'http://localhost:4321',
  outDir: '../docs/html',
  integrations: [pagefind()],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid'],
    },
    rehypePlugins: [
      [rehypeMermaid, { strategy: 'inline-svg' }],
    ],
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark-dimmed',
      },
      wrap: true,
    },
  },
});
