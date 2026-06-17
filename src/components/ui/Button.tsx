import React, { forwardRef } from 'react';

type Variant = 'primary' | 'ghost' | 'accent' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', loading = false, leftIcon, rightIcon, className = '', children, disabled, ...rest },
    ref,
  ) => {
    const variantClass = {
      primary: 'btn-primary',
      ghost: 'btn-ghost',
      accent: 'btn-accent',
      danger: 'btn-danger',
    }[variant];

    const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';

    return (
      <button
        ref={ref}
        className={['btn', variantClass, sizeClass, className].filter(Boolean).join(' ')}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? (
          <>
            <span aria-hidden="true" className="flex items-center gap-1">
              <span className="dot-wave">•</span>
              <span className="dot-wave" style={{ animationDelay: '0.15s' }}>•</span>
              <span className="dot-wave" style={{ animationDelay: '0.3s' }}>•</span>
            </span>
            {/* Keep the accessible name while the spinner shows. */}
            <span className="sr-only">{children}</span>
          </>
        ) : (
          <>
            {leftIcon && <span aria-hidden="true">{leftIcon}</span>}
            <span>{children}</span>
            {rightIcon && <span aria-hidden="true">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  },
);

Button.displayName = 'Button';
export default Button;
