// The tracker's own wording. Shared vocabulary (order steps, statuses) comes from @victorflow/i18n.
// English is the source of truth for keys; catalog.test.ts checks that Arabic has exactly the same.

export const trackerEn = {
  'meta.title': 'Order tracking — VictorFlow',
  'meta.description': 'Follow the progress of your order.',
  'foot.text': 'Read-only order tracking · no account needed',

  'home.title': 'Track your order',
  'home.body': 'Open the tracking link (or scan the QR code) printed on your quote, invoice or delivery slip. Each link is personal to your order.',

  'notFound.title': 'Link not found',
  'notFound.body': 'This tracking link is not valid. Check that you opened the complete link (or scanned the whole QR code), or contact the shop.',

  'unavailable.title': 'Temporarily unavailable',
  'unavailable.body': 'We could not load your order right now. Please try again in a moment.',

  'order.label': 'Order',
  'order.placed': 'Placed',
  'order.expected': 'Expected',
  'order.progress': 'Progress',
  'order.items': 'Your order',
} as const;
