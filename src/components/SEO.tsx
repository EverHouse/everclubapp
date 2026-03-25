import React, { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  url: string;
  image?: string;
  type?: 'website' | 'article';
  keywords?: string;
}

const BASE_URL = 'https://www.everclub.app';
const DEFAULT_IMAGE = '/images/hero-lounge-optimized.webp';

const setMetaTag = (selector: string, attrType: 'name' | 'property', attrValue: string, content: string) => {
  let el = document.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrType, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
};

const setCanonical = (href: string) => {
  let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
};

export const SEO: React.FC<SEOProps> = ({
  title,
  description,
  url,
  image = DEFAULT_IMAGE,
  type = 'website',
  keywords,
}) => {
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
  const fullImage = image.startsWith('http') ? image : `${BASE_URL}${image}`;
  const fullTitle = title.includes('Ever') ? title : `${title} | Ever Members Club`;

  useEffect(() => {
    document.title = fullTitle;

    setMetaTag('meta[name="description"]', 'name', 'description', description);
    if (keywords) {
      setMetaTag('meta[name="keywords"]', 'name', 'keywords', keywords);
    }

    setMetaTag('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    setMetaTag('meta[property="og:description"]', 'property', 'og:description', description);
    setMetaTag('meta[property="og:url"]', 'property', 'og:url', fullUrl);
    setMetaTag('meta[property="og:image"]', 'property', 'og:image', fullImage);
    setMetaTag('meta[property="og:type"]', 'property', 'og:type', type);

    setMetaTag('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);
    setMetaTag('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    setMetaTag('meta[name="twitter:image"]', 'name', 'twitter:image', fullImage);

    setCanonical(fullUrl);
  }, [fullTitle, description, fullUrl, fullImage, type, keywords]);

  return null;
};

export default SEO;
