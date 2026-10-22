// The browser signs in to Firebase with firebaseToken, then reads helpChats/{chatId} live.
export interface WebChatStartResponse {
  chatId: string;
  firebaseToken: string;
}
