import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { saveWorkspace, focusSearch } from '../actions/workspaceActions'; // Adjust action names as needed

const KeyboardShortcuts = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if focus is on an input, textarea, or select
      if (e.target.tagName.match(/input|textarea|select/i)) return;

      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        dispatch(saveWorkspace());
      }
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        dispatch(focusSearch());
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dispatch]);

  return null;
};

export default KeyboardShortcuts;