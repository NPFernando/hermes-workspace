import { ChangeEvent, useState } from 'react';

export function SearchBar() {
  const [query, setQuery] = useState('');

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  return (
    <div className="relative mt-4">
      <input
        type="text"
        placeholder="Search conversations and memories..."
        value={query}
        onChange={handleChange}
        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}