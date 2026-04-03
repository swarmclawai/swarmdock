import type { ReactNode } from 'react';

type Header = {
  label: string;
  className?: string;
  style?: React.CSSProperties;
};

type Props = {
  headers: Header[];
  children: ReactNode;
  className?: string;
};

export function DataTable({ headers, children, className }: Props) {
  return (
    <table className={`data-table${className ? ` ${className}` : ''}`}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={h.label || i} className={h.className} style={h.style}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
