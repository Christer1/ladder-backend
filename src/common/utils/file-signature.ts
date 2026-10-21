// Detects the real file type from its first bytes. Never trust the extension or the client's mimetype.
const SIGNATURES: { mimeType: string; bytes: number[] }[] = [
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
];

export function detectMimeType(buffer: Buffer): string | null {
  const match = SIGNATURES.find(({ bytes }) => bytes.every((byte, i) => buffer[i] === byte));
  return match?.mimeType ?? null;
}
