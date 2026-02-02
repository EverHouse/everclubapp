import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, className = '' }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';

  return (
    <nav
      aria-label="Breadcrumb navigation"
      className={`flex items-center gap-2 text-sm ${className}`}
    >
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <span 
              className={`${isDark ? 'text-bone/40' : 'text-primary/40'}`}
              aria-hidden="true"
            >
              /
            </span>
          )}
          {item.href && index < items.length - 1 ? (
            <Link
              to={item.href}
              className={`${isDark ? 'text-bone/70 hover:text-bone' : 'text-primary/70 hover:text-primary'} transition-colors focus:ring-2 focus:ring-accent focus:outline-none rounded-sm px-1`}
            >
              {item.label}
            </Link>
          ) : (
            <span className={`font-medium ${isDark ? 'text-bone' : 'text-primary'}`}>
              {item.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};

export default Breadcrumb;
