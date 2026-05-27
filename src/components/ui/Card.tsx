import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  interactive?: boolean;
  as?: 'div' | 'article' | 'section';
}

export default function Card({
  hover = false,
  interactive = false,
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}: CardProps) {
  const classes = [
    'card',
    hover ? 'card-hover' : '',
    interactive ? 'card-interactive' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={classes} {...(rest as React.HTMLAttributes<HTMLElement>)}>
      {children}
    </Tag>
  );
}
