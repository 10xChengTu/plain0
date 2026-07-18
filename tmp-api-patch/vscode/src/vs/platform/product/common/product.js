
import productJson from '../../../../../product.json.js';

var product = {
  ...productJson,
  quality: 'stable',
  version: '1.128.1',
  commit: '5264f2156cbcd7aea5fd004d29eaa10209155d66',
  date: '2026-07-15T14:06:42.307Z',
  ...(globalThis._VSCODE_PRODUCT_JSON ?? {})
};

export { product as default };
