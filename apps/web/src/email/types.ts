export interface MyMailbox {
  id: string;
  title: string;
  address: string;
  senderName: string;
  defaultCategoryId: string;
}

export interface EmailTemplate {
  id: string;
  kind: 'reply' | 'auto_response' | 'default_body';
  title: string;
  subject: string | null;
  bodyHtml: string;
  queueIds: string[];
  categoryIds: string[];
  createdById: string | null;
  authorName: string | null;
}
