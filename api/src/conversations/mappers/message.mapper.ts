import type { DocumentVersionStatus, Prisma } from '@prisma/client';
import { CitationZoneEntity, MessageCitationEntity } from '../entities/message-citation.entity.js';
import { MessageEntity } from '../entities/message.entity.js';
import { normalizeGenerationStatus } from '../utils/generation-status.util.js';

export interface RawMessageReference {
  id: string;
  marker: number;
  documentVersionId: string;
  pageOrImageId: string;
  excerpt: string;
  coordinates: string | null;
  documentVersion: {
    id: string;
    documentId: string;
    versionNo: number;
    status: DocumentVersionStatus;
    document: {
      title: string;
      deletedAt: Date | null;
    };
  };
}

export interface RawMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  modelUsed?: string | null;
  parameters?: Prisma.JsonValue | Record<string, unknown> | null;
  status?: string | null;
  notEnoughEvidence?: boolean | null;
  references?: RawMessageReference[];
  createdAt?: Date;
  updatedAt?: Date;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Reads the stored zone of a citation (`{"x","y","width","height"}`, fractions of the page). Anything else,
 * such as older pixel coordinates or a zone that leaves the page, gives null: a client must never draw a
 * zone it cannot place.
 */
export function parseCitationZone(stored: string | null | undefined): CitationZoneEntity | null {
  if (!stored) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  const zone = asRecord(value);
  if (!zone) return null;
  const { x, y, width, height } = zone;
  if (!isFraction(x) || !isFraction(y) || !isFraction(width) || !isFraction(height)) return null;
  // A little tolerance for rounding (0.1 + 0.9 is 1.0000000000000002 in floating point).
  if (width === 0 || height === 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) return null;
  return new CitationZoneEntity({ x, y, width, height });
}

export class MessageMapper {
  static toCitationEntity(ref: RawMessageReference): MessageCitationEntity {
    return new MessageCitationEntity({
      id: ref.id,
      marker: ref.marker,
      documentId: ref.documentVersion.documentId,
      versionId: ref.documentVersionId,
      documentName: ref.documentVersion.document.title,
      versionNumber: ref.documentVersion.versionNo,
      pageOrImageId: ref.pageOrImageId,
      excerpt: ref.excerpt,
      zone: parseCitationZone(ref.coordinates),
      available: ref.documentVersion.document.deletedAt === null && ref.documentVersion.status === 'available',
    });
  }

  static toEntity(raw: RawMessage): MessageEntity {
    const notEnoughEvidence = Boolean(raw.notEnoughEvidence);
    return new MessageEntity({
      id: raw.id,
      conversationId: raw.conversationId,
      role: raw.role,
      content: raw.content,
      modelUsed: raw.modelUsed || 'default',
      parameters: asRecord(raw.parameters),
      // Stored values such as the legacy 'completed' are given in the contract's states (#119, #122).
      status: normalizeGenerationStatus(raw.status || 'done'),
      notEnoughEvidence,
      // "Not enough evidence" answers have no sources, whatever was stored.
      citations: notEnoughEvidence
        ? []
        : [...(raw.references ?? [])]
            .sort((a, b) => a.marker - b.marker)
            .map((ref) => MessageMapper.toCitationEntity(ref)),
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
    });
  }

  /** The answer to a question that was just asked: no content or citations until it is generated. */
  static pendingAnswer(id: string, conversationId: string, now: Date = new Date()): MessageEntity {
    return new MessageEntity({
      id,
      conversationId,
      role: 'assistant',
      content: '',
      modelUsed: 'default',
      parameters: null,
      status: 'pending',
      notEnoughEvidence: false,
      citations: [],
      createdAt: now,
      updatedAt: now,
    });
  }
}
