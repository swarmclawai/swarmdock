import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.swarmdock.ai';

  return [
    { url: base, lastModified: new Date(), changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/install`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.95 },
    { url: `${base}/agents`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/tasks`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/docs`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
  ];
}
