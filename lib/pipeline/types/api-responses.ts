/**
 * Types for external API responses (Salesforce, Gong, Outreach).
 */

// ── Salesforce ──────────────────────────────────────────────

/** Generic SF record (all fields as unknown). */
export type SfRecord = Record<string, unknown> & {
  readonly Id: string;
  readonly attributes?: { readonly type: string; readonly url: string };
};

/** SF SOQL query response. */
export type SfQueryResponse = {
  readonly totalSize: number;
  readonly done: boolean;
  readonly records: readonly SfRecord[];
  readonly nextRecordsUrl?: string;
};

/** SF sObject PATCH response (success = 204 No Content). */
export type SfPatchError = {
  readonly message: string;
  readonly errorCode: string;
  readonly fields?: readonly string[];
};

// ── Gong ────────────────────────────────────────────────────

/** Gong call record from Salesforce (Gong__Gong_Call__c). */
export type GongCallSfRecord = SfRecord & {
  readonly Gong__Call_ID__c?: string;
  readonly Gong__Call_Date_Time__c?: string;
  readonly Gong__Duration__c?: number;
  readonly Gong__Title__c?: string;
};

/** Gong transcript response. */
export type GongTranscriptResponse = {
  readonly callTranscripts: readonly {
    readonly callId: string;
    readonly transcript: readonly {
      readonly speakerName?: string;
      readonly topic?: string;
      readonly sentences: readonly {
        readonly start: number;
        readonly end: number;
        readonly text: string;
      }[];
    }[];
  }[];
};

/** Gong extensive call data response. */
export type GongExtensiveResponse = {
  readonly calls: readonly {
    readonly metaData: {
      readonly id: string;
      readonly title?: string;
      readonly started: string;
      readonly duration: number;
    };
    readonly content?: {
      readonly topics?: readonly { readonly name: string; readonly duration: number }[];
      readonly trackers?: readonly { readonly name: string; readonly count: number }[];
      readonly pointsOfInterest?: {
        readonly actionItems?: readonly { readonly snippet: string }[];
      };
    };
    readonly interaction?: {
      readonly speakers?: readonly {
        readonly name: string;
        readonly talkTime: number;
      }[];
    };
    readonly collaboration?: {
      readonly publicComments?: readonly { readonly comment: string }[];
    };
  }[];
};

// ── Outreach ────────────────────────────────────────────────

/** Outreach mailing record. */
export type OutreachMailing = {
  readonly id: number;
  readonly attributes: {
    readonly bodyText?: string;
    readonly subject?: string;
    readonly deliveredAt?: string;
    readonly openedAt?: string;
    readonly repliedAt?: string;
    readonly bouncedAt?: string;
    readonly mailboxAddress?: string;
  };
  readonly relationships?: {
    readonly prospect?: { readonly data?: { readonly id: number } };
    readonly sequence?: { readonly data?: { readonly id: number } };
    readonly mailbox?: { readonly data?: { readonly id: number } };
  };
};

/** Outreach API list response. */
export type OutreachMailingResponse = {
  readonly data: readonly OutreachMailing[];
  readonly meta?: {
    readonly count: number;
    readonly page?: { readonly current: number; readonly total: number };
  };
  readonly links?: {
    readonly next?: string;
    readonly prev?: string;
  };
};

// ── Credential types ────────────────────────────────────────

/** Gong API credentials (Basic auth). */
export type GongCredentials = {
  readonly accessKey: string;
  readonly accessKeySecret: string;
  readonly baseUrl: string;
};

/** Outreach API credentials (OAuth2 Bearer). */
export type OutreachCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly baseUrl: string;
};
