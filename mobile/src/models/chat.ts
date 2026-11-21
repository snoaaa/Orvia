export type MessageGenerationStatus = "pending" | "generating" | "done" | "failed";

export interface MessageCitation {
  id: string;
  documentId: string;
  versionId: string;
  documentName: string;
  versionNumber: number;
  pageOrImageId: string;
  excerpt: string;
  coordinates: string | null;
  available: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId?: string;
  role: "user" | "assistant";
  content: string;
  modelUsed?: string;
  status?: MessageGenerationStatus;
  citations?: MessageCitation[];
  notEnoughEvidence?: boolean;
  errorMessage?: string;
  retryPrompt?: string;
  createdAt?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  spaceId: string;
  spaceName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageResponse {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  modelUsed?: string;
  status: string;
  citations?: MessageCitation[];
  notEnoughEvidence?: boolean;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  spaceId: string;
  messages: ConversationMessageResponse[];
}

export interface MessageStatusResponse {
  messageId: string;
  conversationId: string;
  status: MessageGenerationStatus;
  ready: boolean;
  modelUsed: string;
  errorCode: string | null;
  answer: ConversationMessageResponse | null;
}
