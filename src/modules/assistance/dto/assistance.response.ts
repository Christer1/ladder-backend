// Shapes match ladder-assistance (its rules.md §7), which uses lowercase statuses.
export type AssistanceMethodName = 'bvn' | 'nin' | 'bvn-and-nin' | 'ladder-id';
export type AssistanceStepStatus = 'not_started' | 'verified';

// Identify answers with a status only: no personal data before liveness.
export interface AssistanceStepResponse {
  status: AssistanceStepStatus;
}

export interface AssistanceStatusResponse {
  method: AssistanceMethodName;
  identity: AssistanceStepStatus;
  liveness: AssistanceStepStatus;
}

export interface AssistanceDetailsResponse {
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: string | null;
  phoneNumber: string | null;
  email: string | null;
  stateOfOrigin: string | null;
  stateOfResidence: string | null;
  town: string | null;
  residentialAddress: string | null;
}
