import { IsIn } from 'class-validator';

// TODO: confirm the "Select ID" options with product.
export const GOVERNMENT_ID_TYPES = [
  'NATIONAL_ID_CARD',
  'INTERNATIONAL_PASSPORT',
  'DRIVERS_LICENSE',
  'VOTERS_CARD',
] as const;

export type GovernmentIdType = (typeof GOVERNMENT_ID_TYPES)[number];

// Sent as multipart/form-data alongside the `file` field.
export class UploadGovernmentIdDto {
  @IsIn(GOVERNMENT_ID_TYPES, { message: 'Select a valid ID type.' })
  idType: GovernmentIdType;
}
