import { PlaywrightAction } from '../types/index.js';

export class HeuristicResolver {
  /**
   * Fast, zero-API local pattern matcher for common test step instructions.
   * Resolves actions deterministically before falling back to LLM.
   */
  public static resolve(stepText: string): PlaywrightAction | null {
    const text = stepText.trim();
    const lower = text.toLowerCase();

    // 1. Toggle switch pattern (e.g. "Set the 'Access Management' toggle switch to On...", "Click 'Account Management' toggle switch...")
    if (lower.includes('toggle switch') || (lower.includes('switch') && (lower.includes('set') || lower.includes('click')))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const name = quoted ? quoted[1] : (text.match(/set\s+(?:the\s+)?([a-z0-9\s]+?)\s+toggle/i)?.[1] || '');
      if (name) {
        const cleanName = name.trim();
        return {
          actionType: 'click',
          selector: `role=switch[name*="${cleanName}"]`,
          semanticName: cleanName,
          semanticRole: 'switch',
          description: `Click toggle switch for '${cleanName}'`
        };
      }
    }

    // 2. Click button pattern (e.g. "Click the 'Access Management' button in sidebar", "Click 'Save' button", "Click 'Create Role' button")
    if (lower.startsWith('click') && (lower.includes('button') || lower.includes('btn'))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      if (quoted) {
        const btnName = quoted[1].trim();
        // Check if it's a context menu item (Detail, Delete, Edit), provided it's not explicitly in a dialog/popup
        if (['detail', 'delete', 'edit'].includes(btnName.toLowerCase()) && !lower.includes('popup') && !lower.includes('dialog') && !lower.includes('confirmation')) {
          return {
            actionType: 'click',
            selector: `role=menuitem[name="${btnName}"]`,
            semanticName: btnName,
            semanticRole: 'menuitem',
            description: `Click '${btnName}' option in menu`
          };
        }
        return {
          actionType: 'click',
          selector: `role=button[name="${btnName}"]`,
          semanticName: btnName,
          semanticRole: 'button',
          description: `Click '${btnName}' button`
        };
      }
    }

    // 3. Ellipsis in row pattern (e.g. "Click ellipsis button in the row of the created role")
    if (lower.includes('ellipsis') && lower.includes('row')) {
      return {
        actionType: 'click',
        selector: `role=row[name*="{{GEN_ROLE}}"] >> button`,
        semanticRole: 'button',
        description: `Click ellipsis button in row for '{{GEN_ROLE}}'`
      };
    }

    // 4. Type random role pattern (e.g. "Type a random role into the role name input")
    if (lower.includes('random role') && (lower.includes('type') || lower.includes('enter') || lower.includes('fill'))) {
      return {
        actionType: 'type',
        selector: `role=textbox[name="Role Name*"]`,
        semanticName: 'Role Name*',
        semanticRole: 'textbox',
        value: '{{GEN_ROLE}}',
        description: `Type random role name into input`
      };
    }

    // 5. Type description pattern (e.g. "Type 'Test Role Description' into the role description input")
    if (lower.includes('role description') && lower.includes('type')) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const val = quoted ? quoted[1] : 'Test Role Description';
      return {
        actionType: 'type',
        selector: `role=textbox[name="Role Description*"]`,
        semanticName: 'Role Description*',
        semanticRole: 'textbox',
        value: val,
        description: `Type '${val}' into description input`
      };
    }

    // 6. Generic verify pattern (e.g. "Verify that 'Action_UserCreate' right exists...", "Verify that the new role is created")
    if (lower.startsWith('verify')) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const val = quoted ? quoted[1] : (lower.includes('new role') || lower.includes('role is created') ? '{{GEN_ROLE}}' : '');
      const isDeletion = lower.includes('delete') || lower.includes('remove') || lower.includes('no longer');
      
      return {
        actionType: 'verify',
        selector: 'body',
        value: val || '{{GEN_ROLE}}',
        description: isDeletion
          ? `Verify that deleted item no longer appears`
          : `Verify that '${val || '{{GEN_ROLE}}'}' is visible`
      };
    }

    return null;
  }
}
