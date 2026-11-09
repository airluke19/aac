// Documentazione di Always Adaptive Coach: Astro + Starlight (open-source), sito statico senza login.
// Italiano (radice) e inglese (/en/), stessi file nelle due cartelle.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const gruppo = (it, en, dir) => ({ label: it, translations: { en }, autogenerate: { directory: dir } });

export default defineConfig({
  site: 'https://docs.aac.run',
  integrations: [
    starlight({
      title: 'Always Adaptive Coach',
      description: 'Il piano di corsa che si adatta a te, ogni giorno.',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: {
        root: { label: 'Italiano', lang: 'it' },
        en: { label: 'English', lang: 'en' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/airluke19/aac' }],
      customCss: ['./src/styles/aac.css'],
      lastUpdated: false,
      pagination: true,
      sidebar: [
        gruppo('Scopri AAC', 'Discover AAC', 'discover'),
        gruppo('Primi passi', 'Getting started', 'start'),
        gruppo('Il coach', 'The coach', 'coach'),
        gruppo('Self-hosting', 'Self-hosting', 'self-hosting'),
        { label: 'Privacy', translations: { en: 'Privacy' }, link: '/privacy/' },
        { label: 'Domande frequenti', translations: { en: 'FAQ' }, link: '/faq/' },
      ],
      head: [
        { tag: 'meta', attrs: { name: 'theme-color', content: '#000000' } },
      ],
    }),
  ],
});
