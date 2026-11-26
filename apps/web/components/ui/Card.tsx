import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ title, className = "", children, ...rest }) => {
  return (
    <div className={`border rounded-lg shadow-sm p-4 ${className}`} {...rest}>
      {title && <h3 className="text-lg font-semibold mb-2">{title}</h3>}
      {children}
    </div>
  );
};
