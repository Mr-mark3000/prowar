import React from "react";

export interface TableProps {
  columns: { header: string; accessor: string }[];
  data: Record<string, any>[];
  className?: string;
}

export const Table: React.FC<TableProps> = ({ columns, data, className = "" }) => {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.accessor}
                scope="col"
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.accessor} className="px-3 py-2 text-sm text-gray-700">
                  {row[col.accessor] ?? "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
