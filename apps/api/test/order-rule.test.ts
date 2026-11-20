import { describe, expect, it } from 'vitest';
import { applyRoutingRules, type RoutingInput, type RoutingRule } from '@relay-desk/domain';
import { orderSubjectRule } from '../src/db/setup-support-team';

const FIELD = 'enquiry-type';
const r = orderSubjectRule(FIELD);
const rule: RoutingRule = {
  id: 'r1',
  title: r.title,
  direction: 'incoming',
  active: true,
  all: r.allConditions,
  any: r.anyConditions,
  actions: r.actions,
};
const typeOf = (subject: string) => {
  const input: RoutingInput = {
    direction: 'incoming',
    from: 'buyer@customer.example',
    to: ['support@ricoman.com'],
    cc: [],
    subject,
    body: '',
    queueId: 'q',
    hasAttachment: false,
    contactFields: {},
    accountFields: {},
  };
  return applyRoutingRules([rule], input).actions.customFields?.[FIELD] ?? null;
};

/** Owner O-30: customers often send a purchase order as "… Ricoman Order" with no PO number. */
describe('"order" in the subject marks a purchase order', () => {
  it('an order email with no PO number is a purchase order (2-hour reply target)', () => {
    expect(typeOf('Blyton Park - EM Light Works - Ricoman Order')).toBe('purchase_order');
    expect(typeOf('New order for Leeds branch')).toBe('purchase_order');
    expect(typeOf('ORDERS attached')).toBe('purchase_order');
  });

  it('chasing or querying an existing order is not a new purchase order', () => {
    for (const subject of [
      'Where is my order?',
      'Order status',
      'Chasing order 51873',
      'Delivery date for our order',
      'Missing items from order',
      'Cancel order please',
      'Amend order quantities',
      'Return of damaged order',
      'Invoice query on order 123',
    ])
      expect(typeOf(subject), subject).toBeNull();
  });

  it('words that merely contain "order" do not count', () => {
    expect(typeOf('Border lights for the car park')).toBeNull();
    expect(typeOf('Reordering shelf labels')).toBeNull();
  });
});
