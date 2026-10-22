import {
  fromInfobipNumber,
  mapInfobipStatus,
  parseInbound,
  parseReports,
  toInfobipNumber,
} from './infobip.mapping';

describe('Infobip mapping', () => {
  it('converts numbers to and from Infobip format', () => {
    expect(toInfobipNumber('+2348150990267')).toBe('2348150990267');
    expect(fromInfobipNumber('2348150990267')).toBe('+2348150990267');
    expect(fromInfobipNumber('+2348150990267')).toBe('+2348150990267');
    expect(fromInfobipNumber('bsuid.abc123')).toBeNull();
    expect(fromInfobipNumber(undefined)).toBeNull();
  });

  it('maps status groups', () => {
    expect(mapInfobipStatus('PENDING')).toBe('SENT');
    expect(mapInfobipStatus('DELIVERED')).toBe('DELIVERED');
    expect(mapInfobipStatus('UNDELIVERABLE')).toBe('FAILED');
    expect(mapInfobipStatus('REJECTED')).toBe('FAILED');
    expect(mapInfobipStatus(undefined)).toBe('QUEUED');
  });

  it('parses inbound text, button replies and media', () => {
    const inbound = parseInbound({
      results: [
        {
          from: '2348150990267',
          to: '447860088970',
          messageId: 'm1',
          message: { type: 'TEXT', text: ' Hi Ladder. Ref: LDR-7K3QX9 ' },
        },
        { from: '2348150990267', messageId: 'm2', message: { type: 'BUTTON', payload: 'yes' } },
        { from: '2348150990267', messageId: 'm3', message: { type: 'IMAGE', url: 'https://x' } },
        { from: 'not-a-phone', messageId: 'm4', message: { type: 'TEXT', text: 'ignored' } },
        { from: '2348150990267', message: { type: 'TEXT', text: 'no id' } },
      ],
    });

    expect(inbound).toEqual([
      { messageId: 'm1', fromPhone: '+2348150990267', text: 'Hi Ladder. Ref: LDR-7K3QX9' },
      { messageId: 'm2', fromPhone: '+2348150990267', text: 'yes' },
      { messageId: 'm3', fromPhone: '+2348150990267', text: '[image message received]' },
    ]);
    expect(parseInbound({ unexpected: true })).toEqual([]);
    expect(parseInbound(null)).toEqual([]);
  });

  it('parses delivery and seen reports', () => {
    expect(
      parseReports({
        results: [
          { messageId: 'a', status: { groupName: 'DELIVERED', name: 'DELIVERED_TO_HANDSET' } },
          {
            messageId: 'b',
            status: { groupName: 'UNDELIVERABLE', name: 'UNDELIVERABLE_NOT_DELIVERED' },
            error: { name: 'EC_OUTSIDE_24H_WINDOW' },
          },
          { messageId: 'c', seenAt: '2026-10-22T10:00:00.000+0000' },
        ],
      }),
    ).toEqual([
      { messageId: 'a', status: 'DELIVERED' },
      { messageId: 'b', status: 'FAILED', errorCode: 'EC_OUTSIDE_24H_WINDOW' },
      { messageId: 'c', status: 'READ' },
    ]);
  });
});
