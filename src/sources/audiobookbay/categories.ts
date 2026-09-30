/**
 * AudioBookBay genre slugs offered as browse chips, in the site's own naming; Browse shows each
 * in the listener's language.
 */
export const abbCategories = [
  { slug: 'sci-fi', name: 'Sci-Fi' },
  { slug: 'fantasy', name: 'Fantasy' },
  { slug: 'mystery', name: 'Mystery' },
  { slug: 'thriller', name: 'Thriller' },
  { slug: 'romance', name: 'Romance' },
  { slug: 'horror', name: 'Horror' },
  { slug: 'historical-fiction', name: 'Historical Fiction' },
  { slug: 'litrpg', name: 'LitRPG' },
  { slug: 'bestsellers', name: 'Bestsellers' },
  { slug: 'classic', name: 'Classic' },
  { slug: 'autobiography-biographies', name: 'Biographies' },
  { slug: 'history', name: 'History' },
  { slug: 'science', name: 'Science' },
  { slug: 'self-help', name: 'Self-help' },
  { slug: 'business', name: 'Business' },
  { slug: 'true-crime', name: 'True Crime' },
  { slug: 'humor', name: 'Humor' },
  { slug: 'children', name: 'Children' },
  { slug: 'teen-young-adult', name: 'Teen & Young Adult' },
] as const

export type AbbCategorySlug = (typeof abbCategories)[number]['slug']
