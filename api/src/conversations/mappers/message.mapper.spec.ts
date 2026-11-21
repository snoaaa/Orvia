import { describe, expect, it } from 'vitest';
import { MessageMapper, parseCitationZone, type RawMessage, type RawMessageReference } from './message.mapper.js';

const ref = (marker: number, overrides: Partial<RawMessageReference> = {}): RawMessageReference => ({
  id: `ref-${marker}`,
  marker,
  documentVersionId: `ver-${marker}`,
  pageOrImageId: `page_${marker}`,
  excerpt: `Excerpt ${marker}`,
  coordinates: null,
  documentVersion: {
    id: `ver-${marker}`,
    documentId: `doc-${marker}`,
    versionNo: 1,
    status: 'available',
    document: { title: `Document ${marker}`, deletedAt: null },
  },
  ...overrides,
});

const answer = (overrides: Partial<RawMessage> = {}): RawMessage => ({
  id: 'msg-1',
  conversationId: 'conv-1',
  role: 'assistant',
  content: 'Gradients flow backwards [1], layer by layer [2].',
  modelUsed: 'mock-rag-v1',
  parameters: { temperature: 0.2 },
  status: 'done',
  notEnoughEvidence: false,
  references: [],
  createdAt: new Date('2026-11-21T10:00:00Z'),
  updatedAt: new Date('2026-11-21T10:00:05Z'),
  ...overrides,
});

describe('MessageMapper (#119 chat contract)', () => {
  it('lists the citations by marker, whatever order they were read in', () => {
    const entity = MessageMapper.toEntity(answer({ references: [ref(2), ref(1)] }));
    expect(entity.citations.map((c) => c.marker)).toEqual([1, 2]);
    expect(entity.citations[0]).toEqual({
      id: 'ref-1',
      marker: 1,
      documentId: 'doc-1',
      versionId: 'ver-1',
      documentName: 'Document 1',
      versionNumber: 1,
      pageOrImageId: 'page_1',
      excerpt: 'Excerpt 1',
      zone: null,
      available: true,
    });
  });

  it('marks a citation unavailable when its document is deleted or its version is not available', () => {
    const deleted = ref(1, {
      documentVersion: { ...ref(1).documentVersion, document: { title: 'Old', deletedAt: new Date() } },
    });
    const processing = ref(2, { documentVersion: { ...ref(2).documentVersion, status: 'indexing' } });
    const entity = MessageMapper.toEntity(answer({ references: [deleted, processing, ref(3)] }));
    expect(entity.citations.map((c) => c.available)).toEqual([false, false, true]);
  });

  it('gives a "not enough evidence" answer without citations', () => {
    const entity = MessageMapper.toEntity(
      answer({ content: 'The documents do not contain this information.', notEnoughEvidence: true, references: [ref(1)] }),
    );
    expect(entity.notEnoughEvidence).toBe(true);
    expect(entity.citations).toEqual([]);
  });

  it.each([
    ['completed', 'done'],
    ['done', 'done'],
    ['streaming', 'generating'],
    ['error', 'failed'],
    [null, 'done'],
    ['', 'done'],
  ])('gives the stored status %s as %s', (stored, expected) => {
    expect(MessageMapper.toEntity(answer({ status: stored })).status).toBe(expected);
  });

  it('defaults the evidence flag and citations of a question', () => {
    const entity = MessageMapper.toEntity(answer({ role: 'user', notEnoughEvidence: undefined, references: undefined }));
    expect(entity.notEnoughEvidence).toBe(false);
    expect(entity.citations).toEqual([]);
  });

  it('builds the pending answer of a question', () => {
    const now = new Date('2026-11-21T10:00:00Z');
    expect(MessageMapper.pendingAnswer('msg-2', 'conv-1', now)).toEqual({
      id: 'msg-2',
      conversationId: 'conv-1',
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
  });
});

describe('parseCitationZone (#119)', () => {
  it('reads a zone given as fractions of the page', () => {
    expect(parseCitationZone('{"x":0.1,"y":0.9,"width":0.9,"height":0.1}')).toEqual({
      x: 0.1,
      y: 0.9,
      width: 0.9,
      height: 0.1,
    });
    expect(parseCitationZone('{"x":0,"y":0,"width":1,"height":1}')).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it.each([
    ['nothing stored', null],
    ['an empty value', ''],
    ['invalid JSON', '{x:'],
    ['an array', '[0.1,0.2,0.3,0.4]'],
    ['older pixel coordinates', '{"x1":50,"y1":120,"x2":450,"y2":180}'],
    ['a value above 1', '{"x":0.1,"y":0.2,"width":1.5,"height":0.1}'],
    ['a negative value', '{"x":-0.1,"y":0.2,"width":0.5,"height":0.1}'],
    ['a zone leaving the page', '{"x":0.6,"y":0.2,"width":0.5,"height":0.1}'],
    ['an empty zone', '{"x":0.1,"y":0.2,"width":0,"height":0.1}'],
    ['text values', '{"x":"0.1","y":"0.2","width":"0.5","height":"0.1"}'],
  ])('gives null for %s', (_label, stored) => {
    expect(parseCitationZone(stored)).toBeNull();
  });
});
