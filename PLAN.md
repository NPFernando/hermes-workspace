# Keyboard Navigation Support for Modal Dialogs

## Summary of the change
Enhance modal dialogs in the Hermes workspace to provide comprehensive keyboard navigation support, ensuring all dialogs can be fully operated using only a keyboard (Tab, Shift+Tab, Enter, Escape, etc.).

## Files to modify
1. `/home/ubuntu/hermes-workspace/src/components/ui/dialog.tsx` - Base dialog components
2. `/home/ubuntu/hermes-workspace/src/components/ui/alert-dialog.tsx` - Alert dialog components
3. `/home/ubuntu/hermes-workspace/src/components/usage-meter/context-alert-modal.tsx` - Context alert modal
4. `/home/ubuntu/hermes-workspace/src/screens/chat/components/providers-dialog.tsx` - Providers dialog
5. `/home/ubuntu/hermes-workspace/src/screens/chat/components/sidebar/session-delete-dialog.tsx` - Session delete dialog

## Step-by-step implementation instructions

### 1. Enhance base dialog components (`dialog.tsx`)
- Add `defaultFocusRef` prop to `DialogRoot` to allow specifying which element should receive initial focus
- Ensure focus trapping is properly configured (Radix UI Dialog should handle this by default)
- Add optional `returnFocus` functionality to return focus to the trigger when dialog closes
- Consider enhancing visual focus indicators if needed

### 2. Enhance alert dialog components (`alert-dialog.tsx`)
- Apply similar enhancements as to the base dialog components
- Add `defaultFocusRef` prop to `AlertDialogRoot`
- Ensure proper focus management

### 3. Update ContextAlertModal (`context-alert-modal.tsx`)
- Add `onKeyDown` handler to the main container or a suitable parent element
- Implement logic to handle:
  - Enter key: Trigger the primary action ("Got it" button)
  - Escape key: Close the dialog (should already work via Dialog.Close on button)
- Ensure proper focus initialization (consider focusing the "Got it" button by default)

### 4. Update ProvidersDialog (`providers-dialog.tsx`)
- Analyze the `ProvidersScreen` component to determine if it needs focus management
- If the contained screen has interactive elements that should receive initial focus, consider:
  - Adding a ref to focus the appropriate element when dialog opens
  - Or ensuring the embedded component handles its own focus properly
- Add keyboard handling for common actions if needed

### 5. Update SessionDeleteDialog (`session-delete-dialog.tsx`)
- Add `onKeyDown` handler to handle:
  - Enter key: Trigger the confirm action (if focused on Cancel, perhaps trigger Cancel; if focused on Delete, trigger Delete)
  - Or implement more sophisticated logic based on which button has focus
- Ensure Escape key works to cancel (should work via AlertDialog.Cancel onClick)

## How to verify the change works
1. **Manual keyboard testing**:
   - Tab through all dialog elements to ensure logical focus order
   - Verify visible focus indicators are present
   - Test Escape key closes dialogs in all cases
   - Test Enter key triggers appropriate actions:
     - In forms: submits or performs primary action
     - In confirmation dialogs: confirms or cancels appropriately
   - Verify focus returns to triggering element when dialog closes (where applicable)

2. **Automated testing considerations**:
   - Ensure existing tests still pass
   - Consider adding keyboard interaction tests if test framework supports it

3. **Accessibility validation**:
   - Test with screen reader if possible (NVDA, JAWS, or VoiceOver)
   - Verify ARIA attributes remain correct
   - Ensure dialog role and properties are preserved
