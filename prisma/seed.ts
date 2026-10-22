/* eslint-disable no-console -- CLI script: printing the test data is its purpose */
import { PrismaClient, VerificationType } from '@prisma/client';

// Mock BVN/NIN registry for testing. Deterministic: every run produces the same records,
// and re-running updates them in place.
const RECORDS_PER_TYPE = 20;
const VALID_PER_TYPE = 14;
// People with both a BVN and a NIN (same name and date of birth), for ladder-assistance's
// "BVN and NIN" option. The records above are separate people per type.
const LINKED_PEOPLE = 6;

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

// Index-aligned with FIRST_NAMES.
const FEMALE_FIRST_NAMES = new Set([
  'Adaeze',
  'Ngozi',
  'Funmilayo',
  'Aisha',
  'Zainab',
  'Yetunde',
  'Chiamaka',
  'Halima',
  'Bukola',
  'Amina',
]);
const STATES = [
  { state: 'Lagos', towns: ['Ikeja', 'Lekki', 'Yaba', 'Surulere'] },
  { state: 'Oyo', towns: ['Ibadan', 'Ogbomosho', 'Oyo'] },
  { state: 'FCT', towns: ['Garki', 'Wuse', 'Gwarinpa'] },
  { state: 'Rivers', towns: ['Port Harcourt', 'Bonny'] },
  { state: 'Kano', towns: ['Kano', 'Wudil'] },
  { state: 'Enugu', towns: ['Enugu', 'Nsukka'] },
  { state: 'Anambra', towns: ['Awka', 'Onitsha', 'Nnewi'] },
  { state: 'Kaduna', towns: ['Kaduna', 'Zaria'] },
];
const STREETS = [
  'Allen Avenue',
  'Admiralty Way',
  'Ring Road',
  'Aminu Kano Crescent',
  'Old Aba Road',
  'Ogui Road',
  'Zik Avenue',
  'Ahmadu Bello Way',
];
const PHONE_PREFIXES = ['0803', '0806', '0813', '0816', '0703', '0706', '0903', '0810'];

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

type Person = {
  dateOfBirth: Date;
  firstName: string;
  lastName: string;
};

// Contact and address details for the ladder-assistance "Your details" screen. Uses its own random
// stream so adding it did not change the numbers, names or dates of birth seeded before.
function buildProfile(person: Person, random: () => number) {
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const residence = pick(STATES);
  const town = pick(residence.towns);
  const digits = (length: number) => Array.from({ length }, () => int(0, 9)).join('');

  return {
    gender: FEMALE_FIRST_NAMES.has(person.firstName) ? 'Female' : 'Male',
    phoneNumber: pick(PHONE_PREFIXES) + digits(7),
    // example.com never delivers mail.
    email: `${person.firstName}.${person.lastName}${int(1, 99)}@example.com`.toLowerCase(),
    stateOfOrigin: pick(STATES).state,
    stateOfResidence: residence.state,
    town,
    residentialAddress: `${int(1, 120)}, ${pick(STREETS)}, ${town}`,
  };
}

function buildRecords(type: VerificationType, seed: number) {
  const random = createRandom(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const prefix = type === VerificationType.BVN ? '22' : '7'; // BVNs start with 22 in practice

  const profileRandom = createRandom(seed + 500);

  return Array.from({ length: RECORDS_PER_TYPE }, (_, i) => {
    const digits = Array.from({ length: 11 - prefix.length }, () => int(0, 9)).join('');
    // Adults aged roughly 19 to 70.
    const dateOfBirth = new Date(Date.UTC(int(1956, 2006), int(0, 11), int(1, 28)));
    const person = {
      dateOfBirth,
      firstName: FIRST_NAMES[int(0, FIRST_NAMES.length - 1)],
      lastName: LAST_NAMES[int(0, LAST_NAMES.length - 1)],
    };
    return {
      type,
      number: prefix + digits,
      ...person,
      isValid: i < VALID_PER_TYPE,
      ...buildProfile(person, profileRandom),
    };
  });
}

// One BVN and one NIN per person, sharing every detail.
function buildLinkedRecords(seed: number) {
  const random = createRandom(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const digits = (length: number) => Array.from({ length }, () => int(0, 9)).join('');

  return Array.from({ length: LINKED_PEOPLE }, () => {
    const person = {
      dateOfBirth: new Date(Date.UTC(int(1956, 2006), int(0, 11), int(1, 28))),
      firstName: FIRST_NAMES[int(0, FIRST_NAMES.length - 1)],
      lastName: LAST_NAMES[int(0, LAST_NAMES.length - 1)],
    };
    const shared = { ...person, isValid: true, ...buildProfile(person, random) };
    return [
      { type: VerificationType.BVN, number: '229' + digits(8), ...shared },
      { type: VerificationType.NIN, number: '79' + digits(9), ...shared },
    ];
  }).flat();
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const linked = buildLinkedRecords(3003);
  const records = [
    ...buildRecords(VerificationType.BVN, 1001),
    ...buildRecords(VerificationType.NIN, 2002),
    ...linked,
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
  console.log('BVN + NIN pairs (same person) for ladder-assistance "BVN and NIN":');
  console.table(
    linked
      .filter((r) => r.type === VerificationType.BVN)
      .map((bvn) => {
        const nin = linked.find((r) => r.type === VerificationType.NIN && r.email === bvn.email);
        return {
          bvn: bvn.number,
          nin: nin?.number,
          dateOfBirth: bvn.dateOfBirth.toISOString().slice(0, 10),
          name: `${bvn.firstName} ${bvn.lastName}`,
        };
      }),
  );
  console.log(`Seeded ${records.length} identity records.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
