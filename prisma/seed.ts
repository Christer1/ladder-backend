/* eslint-disable no-console -- CLI script: printing the test data is its purpose */
import { PrismaClient, VerificationType } from '@prisma/client';

// Mock BVN/NIN registry for testing. Deterministic: every run produces the same records,
// and re-running updates them in place.
const RECORDS_PER_TYPE = 20;
const VALID_PER_TYPE = 14;

const FIRST_NAMES = [
  'Adaeze',
  'Chinedu',
  'Oluwaseun',
  'Ngozi',
  'Ibrahim',
  'Funmilayo',
  'Emeka',
  'Aisha',
  'Tunde',
  'Zainab',
  'Obinna',
  'Yetunde',
  'Musa',
  'Chiamaka',
  'Segun',
  'Halima',
  'Ifeanyi',
  'Bukola',
  'Kelechi',
  'Amina',
];
const LAST_NAMES = [
  'Okafor',
  'Adeyemi',
  'Bello',
  'Eze',
  'Ogunleye',
  'Abubakar',
  'Nwosu',
  'Balogun',
  'Okonkwo',
  'Lawal',
  'Ibekwe',
  'Adebayo',
  'Usman',
  'Chukwu',
  'Afolabi',
  'Danjuma',
  'Obi',
  'Ojo',
  'Nnamdi',
  'Yusuf',
];

// Small seeded PRNG (mulberry32) so the data is stable between runs.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRecords(type: VerificationType, seed: number) {
  const random = createRandom(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const prefix = type === VerificationType.BVN ? '22' : '7'; // BVNs start with 22 in practice

  return Array.from({ length: RECORDS_PER_TYPE }, (_, i) => {
    const digits = Array.from({ length: 11 - prefix.length }, () => int(0, 9)).join('');
    // Adults aged roughly 19 to 70.
    const dateOfBirth = new Date(Date.UTC(int(1956, 2006), int(0, 11), int(1, 28)));
    return {
      type,
      number: prefix + digits,
      dateOfBirth,
      firstName: FIRST_NAMES[int(0, FIRST_NAMES.length - 1)],
      lastName: LAST_NAMES[int(0, LAST_NAMES.length - 1)],
      isValid: i < VALID_PER_TYPE,
    };
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const records = [
    ...buildRecords(VerificationType.BVN, 1001),
    ...buildRecords(VerificationType.NIN, 2002),
  ];

  try {
    for (const record of records) {
      const { type, number, ...data } = record;
      await prisma.identityRecord.upsert({
        where: { type_number: { type, number } },
        create: record,
        update: data,
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  console.table(
    records.map((r) => ({
      type: r.type,
      number: r.number,
      dateOfBirth: r.dateOfBirth.toISOString().slice(0, 10),
      name: `${r.firstName} ${r.lastName}`,
      result: r.isValid ? 'VALID' : 'INVALID',
    })),
  );
  console.log(`Seeded ${records.length} identity records.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
