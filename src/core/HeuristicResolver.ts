import { PlaywrightAction } from '../types/index.js';

export class HeuristicResolver {
  /**
   * Fast, zero-API local pattern matcher for common test step instructions.
   * Resolves actions deterministically in sub-millisecond time before falling back to Gemini.
   */
  public static resolve(stepText: string): PlaywrightAction | null {
    const text = stepText.trim();
    const lower = text.toLowerCase();

    // 1. Username input
    if (lower.includes('username') && (lower.includes('type') || lower.includes('enter') || lower.includes('fill'))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const val = quoted ? quoted[1] : 'standard_user';
      return {
        actionType: 'type',
        selector: '[data-test="username"], #user-name, input[placeholder*="Username" i]',
        semanticName: 'Username',
        semanticRole: 'textbox',
        value: val,
        description: `Type '${val}' into username input`
      };
    }

    // 2. Password input
    if (lower.includes('password') && (lower.includes('type') || lower.includes('enter') || lower.includes('fill'))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const val = quoted ? quoted[1] : 'secret_sauce';
      return {
        actionType: 'type',
        selector: '[data-test="password"], #password, input[placeholder*="Password" i]',
        semanticName: 'Password',
        semanticRole: 'textbox',
        value: val,
        description: `Type password into password input`
      };
    }

    // 3. Checkout inputs: First Name
    if ((lower.includes('first name') || lower.includes('firstname')) && (lower.includes('type') || lower.includes('enter') || lower.includes('fill'))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const val = quoted ? quoted[1] : '{{GEN_FIRST_NAME}}';
      return {
        actionType: 'type',
        selector: '[data-test="firstName"], #first-name, input[placeholder*="First Name" i]',
        semanticName: 'First Name',
        semanticRole: 'textbox',
        value: val,
        description: `Type '${val}' into First Name input`
      };
    }

    // 4. Checkout inputs: Last Name
    if ((lower.includes('last name') || lower.includes('lastname')) && (lower.includes('type') || lower.includes('enter') || lower.includes('fill'))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const val = quoted ? quoted[1] : '{{GEN_LAST_NAME}}';
      return {
        actionType: 'type',
        selector: '[data-test="lastName"], #last-name, input[placeholder*="Last Name" i]',
        semanticName: 'Last Name',
        semanticRole: 'textbox',
        value: val,
        description: `Type '${val}' into Last Name input`
      };
    }

    // 5. Checkout inputs: Postal Code / Zip
    if ((lower.includes('postal') || lower.includes('zip')) && (lower.includes('type') || lower.includes('enter') || lower.includes('fill'))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const val = quoted ? quoted[1] : '{{GEN_ZIP}}';
      return {
        actionType: 'type',
        selector: '[data-test="postalCode"], #postal-code, input[placeholder*="Zip" i], input[placeholder*="Postal" i]',
        semanticName: 'Postal Code',
        semanticRole: 'textbox',
        value: val,
        description: `Type '${val}' into Postal Code input`
      };
    }

    // 6. Generic Type Pattern: Type 'xyz' into 'abc' input
    if ((lower.startsWith('type') || lower.startsWith('enter') || lower.startsWith('fill')) && text.includes('into')) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const afterInto = text.split(/into\s+(?:the\s+)?/i)[1]?.replace(/input.*$/i, '').replace(/field.*$/i, '').trim();
      if (quoted && afterInto) {
        const cleanTarget = afterInto.replace(/['"]/g, '').trim();
        return {
          actionType: 'type',
          selector: `[data-test*="${cleanTarget.toLowerCase().replace(/\s+/g, '-')}"], input[name*="${cleanTarget}" i], input[placeholder*="${cleanTarget}" i], [aria-label*="${cleanTarget}" i]`,
          semanticName: cleanTarget,
          semanticRole: 'textbox',
          value: quoted[1],
          description: `Type '${quoted[1]}' into '${cleanTarget}' input`
        };
      }
    }

    // 7. Shopping Cart Icon / Link click
    if (lower.includes('cart') && (lower.includes('icon') || lower.includes('link') || lower.includes('badge') || lower.includes('shopping cart')) && (lower.startsWith('click') || lower.startsWith('open') || lower.startsWith('go to'))) {
      return {
        actionType: 'click',
        selector: '[data-test="shopping-cart-link"], .shopping_cart_link, [data-test="shopping-cart-badge"]',
        semanticName: 'Shopping Cart',
        semanticRole: 'link',
        description: `Click shopping cart icon`
      };
    }

    // 8. Add to cart button for a specific item
    if (lower.includes('add') && lower.includes('cart')) {
      const itemMatch = text.match(/for\s+['"]([^'"]+)['"]/i) || text.match(/['"]([^'"]+)['"]$/i);
      const itemName = itemMatch ? itemMatch[1].trim() : (text.match(/['"]([^'"]+)['"]/)?.[1]?.trim() || '');
      const slug = itemName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return {
        actionType: 'click',
        selector: slug ? `[data-test="add-to-cart-${slug}"], .inventory_item:has-text("${itemName}") button` : '[data-test*="add-to-cart"], button:has-text("Add to cart")',
        semanticName: `Add to cart (${itemName || 'item'})`,
        semanticRole: 'button',
        description: `Add '${itemName || 'item'}' to cart`
      };
    }

    // 9. Remove from cart for a specific item
    if (lower.includes('remove')) {
      const itemMatch = text.match(/for\s+['"]([^'"]+)['"]/i) || text.match(/['"]([^'"]+)['"]$/i);
      const itemName = itemMatch ? itemMatch[1].trim() : (text.match(/['"]([^'"]+)['"]/)?.[1]?.trim() || '');
      const slug = itemName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return {
        actionType: 'click',
        selector: slug ? `[data-test="remove-${slug}"], .cart_item:has-text("${itemName}") button, .inventory_item:has-text("${itemName}") button` : '[data-test*="remove"], button:has-text("Remove")',
        semanticName: `Remove (${itemName || 'item'})`,
        semanticRole: 'button',
        description: `Remove '${itemName || 'item'}' from cart`
      };
    }

    // 10. Product Sort dropdown
    if (lower.includes('sort') && (lower.includes('select') || lower.includes('filter') || lower.includes('choose'))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      if (quoted) {
        let sortVal = quoted[1].trim();
        const sortLower = sortVal.toLowerCase();
        let optionVal = sortVal;
        if (sortLower.includes('a to z') || sortLower === 'az') optionVal = 'az';
        else if (sortLower.includes('z to a') || sortLower === 'za') optionVal = 'za';
        else if (sortLower.includes('low to high') || sortLower === 'lohi') optionVal = 'lohi';
        else if (sortLower.includes('high to low') || sortLower === 'hilo') optionVal = 'hilo';

        return {
          actionType: 'select',
          selector: '[data-test="product-sort-container"], .product_sort_container',
          semanticName: 'Product Sort Dropdown',
          value: optionVal,
          description: `Sort products by '${sortVal}'`
        };
      }
    }

    // 10.5 Back home button
    if ((lower.includes('back home') || lower.includes('back to products')) && (lower.startsWith('click') || lower.includes('button'))) {
      return {
        actionType: 'click',
        selector: '[data-test="back-to-products"], #back-to-products, button:has-text("Back Home")',
        semanticName: 'back-to-products',
        semanticRole: 'button',
        description: `Click 'Back Home' button`
      };
    }

    // 11. Click button pattern (e.g. "Click the 'Login' button", "Click 'Checkout' button", "Click the 'Continue' button")
    if (lower.startsWith('click') && (lower.includes('button') || lower.includes('btn'))) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const btnName = quoted ? quoted[1].trim() : (text.match(/click\s+(?:the\s+)?([a-z0-9\s-]+?)\s+button/i)?.[1]?.trim() || '');
      if (btnName) {
        const slug = btnName.toLowerCase().replace(/\s+/g, '-');
        return {
          actionType: 'click',
          selector: `[data-test="${slug}"], [data-test="${slug}-button"], button:has-text("${btnName}"), input[value="${btnName}" i]`,
          semanticName: btnName,
          semanticRole: 'button',
          description: `Click '${btnName}' button`
        };
      }
    }

    // 12. Burger menu & Logout pattern
    if (lower.includes('logout') && lower.startsWith('click')) {
      return {
        actionType: 'click',
        selector: '[data-test="logout-sidebar-link"], #logout_sidebar_link, a:has-text("Logout")',
        semanticName: 'Logout',
        semanticRole: 'link',
        description: `Click Logout link`
      };
    }
    if ((lower.includes('burger menu') || lower.includes('sidebar menu') || lower.includes('open menu')) && lower.startsWith('click')) {
      return {
        actionType: 'click',
        selector: '[data-test="open-menu"], #react-burger-menu-btn, button:has-text("Open Menu")',
        semanticName: 'Open Menu',
        semanticRole: 'button',
        description: `Click burger menu button`
      };
    }

    // 13. Generic verify pattern (e.g. "Verify that 'Products' is visible", "Verify that 'Thank you for your order!' exists")
    if (lower.startsWith('verify')) {
      const quoted = text.match(/['"]([^'"]+)['"]/);
      const val = quoted ? quoted[1] : text.replace(/^verify\s+(?:that\s+)?/i, '').replace(/\s+(?:exists|is visible|appears|is displayed).*$/i, '').trim();
      const isDeletion = lower.includes('not visible') || lower.includes('removed') || lower.includes('disappear') || lower.includes('no longer');

      return {
        actionType: 'verify',
        selector: 'body',
        value: val,
        description: isDeletion
          ? `Verify that '${val}' no longer appears`
          : `Verify that '${val}' is visible`
      };
    }

    return null;
  }
}
