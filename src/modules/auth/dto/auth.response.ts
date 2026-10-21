export interface OtpSentResponse {
  otpExpiresIn: number; // seconds
  resendAvailableIn: number; // seconds
}

export interface SessionResponse {
  token: string;
  expiresAt: Date;
}
