import { useEffect } from 'react';

const KeyboardShortcuts = () => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if focus is on an input, textarea, or select
      if (e.target.tagName.match(/input|textarea|select/i)) return;

      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        console.log('Save shortcut pressed');
      }
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        console.log('Focus search shortcut pressed');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
  return null;
};

export default KeyboardShortcuts;