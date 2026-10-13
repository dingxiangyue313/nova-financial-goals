import type { SVGProps } from 'react';

interface NovaMarkProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number;
}

/** The NOVA monogram is intentionally an inline SVG so it stays sharp and has no image background. */
export function NovaMark({ size = 32, className, ...props }: NovaMarkProps) {
  return (
    <svg
      aria-label="NOVA 标志"
      className={className}
      data-size={size}
      data-testid="nova-mark"
      data-transparent="true"
      fill="none"
      height={size}
      role="img"
      viewBox="0 0 64 64"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M16 47V18L35 47V18" stroke="#0F6B6D" strokeLinecap="round" strokeLinejoin="round" strokeWidth="7" />
      <path d="M43 18V47" stroke="#63B5B2" strokeLinecap="round" strokeWidth="7" />
      <circle cx="43" cy="18" fill="#E7A100" r="3.5" />
    </svg>
  );
}
