// Shows only the last 4 characters: maskLast4('8901', 11) → '*******8901'.
export const maskLast4 = (last4: string, totalLength: number): string =>
  '*'.repeat(Math.max(totalLength - last4.length, 0)) + last4;

export const last4 = (value: string): string => value.slice(-4);
