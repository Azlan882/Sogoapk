import React from 'react';
import * as LucideIcons from 'lucide-react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: string;
  size?: number;
  className?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, className = '', ...props }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComponent = (LucideIcons as any)[name] || LucideIcons.HelpCircle;
  return <IconComponent size={size} className={className} {...props} />;
};
