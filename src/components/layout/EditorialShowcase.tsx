import React from 'react';
import { Link } from 'react-router-dom';

interface EditorialShowcaseProps {
  overline: string;
  title: React.ReactNode;
  description: string;
  image: string;
  imageAlt: string;
  ctaLabel?: string;
  ctaLink?: string;
  reversed?: boolean;
  className?: string;
}

const EditorialShowcase: React.FC<EditorialShowcaseProps> = ({
  overline,
  title,
  description,
  image,
  imageAlt,
  ctaLabel,
  ctaLink,
  reversed = false,
  className = '',
}) => {
  return (
    <section className={`bg-bone dark:bg-[#141414] ${className}`}>
      <div className={`grid grid-cols-1 md:grid-cols-2 min-h-[600px] lg:min-h-[700px] ${reversed ? '' : ''}`}>
        <div className={`relative overflow-hidden ${reversed ? 'md:order-2' : 'md:order-1'}`}>
          <img
            src={image}
            alt={imageAlt}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-emphasis ease-out hover:scale-105"
            loading="lazy"
          />
        </div>

        <div className={`flex flex-col justify-center px-8 py-16 md:px-12 lg:px-20 md:py-20 lg:py-24 ${reversed ? 'md:order-1' : 'md:order-2'}`}>
          <span
            className="text-[0.75rem] uppercase text-primary/50 dark:text-white/50 mb-6 block"
            style={{
              fontFamily: 'var(--font-label)',
              fontWeight: 700,
              fontStretch: '75%',
              letterSpacing: '0.15em',
            }}
          >
            {overline}
          </span>

          <h2
            className="text-primary dark:text-white mb-6 md:mb-8"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2.25rem, 5vw, 6rem)',
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h2>

          <p
            className="text-base md:text-lg text-primary/70 dark:text-white/70 mb-8 md:mb-10 max-w-lg"
            style={{
              fontFamily: 'var(--font-body)',
              lineHeight: 1.75,
            }}
          >
            {description}
          </p>

          {ctaLabel && ctaLink && (
            <Link
              to={ctaLink}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary dark:text-white hover:text-primary/70 dark:hover:text-white/70 transition-colors group w-fit"
            >
              <span className="border-b border-primary/30 dark:border-white/30 group-hover:border-primary/60 dark:group-hover:border-white/60 transition-colors pb-0.5">
                {ctaLabel}
              </span>
              <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">
                arrow_forward
              </span>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
};

export default EditorialShowcase;
