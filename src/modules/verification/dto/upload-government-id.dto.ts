import { IsIn } from 'class-validator';
import { GOVERNMENT_ID_SIDES, GovernmentIdType } from '../../../config/app.config';

// Text part of the multipart upload; the images arrive as files named "front" and "back".
export class UploadGovernmentIdDto {
  @IsIn(Object.keys(GOVERNMENT_ID_SIDES), { message: 'Select the type of ID.' })
  idType: GovernmentIdType;
}
