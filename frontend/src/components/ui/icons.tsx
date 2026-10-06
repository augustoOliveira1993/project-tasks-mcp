import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 14, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>;
}

export const IconMail = (props: IconProps) => <Icon {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Icon>;
export const IconQuestion = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.6 2.6 0 1 1 3.7 2.3c-.8.5-1.3 1-1.3 1.9M12 17h.01" /></Icon>;
export const IconDiff = (props: IconProps) => <Icon {...props}><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 8.2v7.6M18 10.2c0 4-6 3-11 6.2" /></Icon>;
export const IconCheck = (props: IconProps) => <Icon {...props}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const IconSearch = (props: IconProps) => <Icon {...props}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>;
export const IconRefresh = (props: IconProps) => <Icon {...props}><path d="M20 11a8 8 0 0 0-14.5-3.5M4 5v4h4M4 13a8 8 0 0 0 14.5 3.5M20 19v-4h-4" /></Icon>;
export const IconClose = (props: IconProps) => <Icon {...props}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const IconMore = (props: IconProps) => <Icon {...props}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></Icon>;
export const IconChevron = (props: IconProps) => <Icon {...props}><path d="m7 10 5 5 5-5" /></Icon>;
export const IconFeature = (props: IconProps) => <Icon {...props}><path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5" /></Icon>;
export const IconCopy = (props: IconProps) => <Icon {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>;
export const IconAlert = (props: IconProps) => <Icon {...props}><path d="M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.5h.01" /></Icon>;
export const IconMenu = (props: IconProps) => <Icon {...props}><path d="M4 6h16M4 12h16M4 18h16" /></Icon>;
