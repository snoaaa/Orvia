import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { STORAGE_SERVICE } from '../src/storage/storage.constants.js';
import type { StorageService } from '../src/storage/storage.service.js';

/**
 * Multi-format enterprise document ingestion (#150):
 * - Pre-ingestion validation (`POST /documents/spaces/:spaceId/validate-file`)
 * - Document upload (`POST /documents/spaces/:spaceId/upload`) across Office OpenXML (.docx, .pptx, .xlsx),
 *   Legacy Office OLE2 (.doc, .ppt, .xls), OpenDocument (.odt, .ods, .odp), and Text (.txt, .md, .csv)
 * - Deep OpenXML ZIP structure validation rejecting spoofed archives
 * - Format-aware downstream processing pipeline routing (`office_extraction`, `slide_extraction`,
 *   `tabular_extraction`, `text_chunking`)
 * - Cross-format version replacement (`POST /documents/:id/replace`)
 * - Filtering by document type (`GET /documents?type=word|presentation|spreadsheet|text`)
 */
describe('Multi-format document ingestion (e2e) (#150)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let storage: StorageService;

  const stamp = Date.now();
  const tag = `MF${stamp}`;
  let schoolId = '';
  let spaceId = '';
  let managerId = '';
  const storageKeys: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;

  const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const ole2Header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    storage = app.get(STORAGE_SERVICE);

    const managerRole = await prisma.role.findFirstOrThrow({
      where: { name: 'CONTENT_MANAGER' },
    });

    const school = await prisma.school.create({
      data: { name: `Test E2E MultiFormat School ${stamp}` },
    });
    schoolId = school.id;

    const space = await prisma.space.create({
      data: { schoolId, name: `${tag} Space` },
    });
    spaceId = space.id;

    const manager = await prisma.user.create({
      data: {
        email: `e2e-multiformat-mgr-${stamp}@school.edu`,
        fullName: 'Format Manager',
        status: 'ACTIVE',
      },
    });
    managerId = manager.id;

    await prisma.userAssignment.create({
      data: {
        userId: managerId,
        schoolId,
        roleId: managerRole.id,
      },
    });
  });

  afterAll(async () => {
    for (const key of storageKeys) {
      await storage.delete(key).catch(() => undefined);
    }
    await prisma.user.deleteMany({
      where: { email: { contains: `-${stamp}@school.edu` } },
    });
    await prisma.school.deleteMany({
      where: { name: { contains: 'Test E2E MultiFormat School' } },
    });
    await app.close();
  });

  describe('POST /documents/spaces/:spaceId/validate-file', () => {
    it('validates Office OpenXML (.docx, .pptx, .xlsx), OpenDocument (.odt, .ods, .odp), Legacy OLE2 (.doc, .ppt, .xls), and Text (.txt, .md, .csv)', async () => {
      const token = await bearer(managerId);

      const samples = [
        {
          filename: 'syllabus.docx',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from('[Content_Types].xml...word/document.xml...word/_rels'),
          ]),
          expectedMime:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          expectedExt: 'docx',
        },
        {
          filename: 'slides.pptx',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from('[Content_Types].xml...ppt/presentation.xml...ppt/slides'),
          ]),
          expectedMime:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          expectedExt: 'pptx',
        },
        {
          filename: 'grades.xlsx',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from('[Content_Types].xml...xl/workbook.xml...xl/worksheets'),
          ]),
          expectedMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          expectedExt: 'xlsx',
        },
        {
          filename: 'notes.odt',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from('mimetypeapplication/vnd.oasis.opendocument.text...content.xml'),
          ]),
          expectedMime: 'application/vnd.oasis.opendocument.text',
          expectedExt: 'odt',
        },
        {
          filename: 'budget.ods',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from('mimetypeapplication/vnd.oasis.opendocument.spreadsheet...content.xml'),
          ]),
          expectedMime: 'application/vnd.oasis.opendocument.spreadsheet',
          expectedExt: 'ods',
        },
        {
          filename: 'deck.odp',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from('mimetypeapplication/vnd.oasis.opendocument.presentation...content.xml'),
          ]),
          expectedMime: 'application/vnd.oasis.opendocument.presentation',
          expectedExt: 'odp',
        },
        {
          filename: 'legacy.doc',
          buffer: Buffer.concat([ole2Header, Buffer.from('WordDocument stream content')]),
          expectedMime: 'application/msword',
          expectedExt: 'doc',
        },
        {
          filename: 'legacy.ppt',
          buffer: Buffer.concat([ole2Header, Buffer.from('PowerPoint Document stream content')]),
          expectedMime: 'application/vnd.ms-powerpoint',
          expectedExt: 'ppt',
        },
        {
          filename: 'legacy.xls',
          buffer: Buffer.concat([ole2Header, Buffer.from('Workbook stream content')]),
          expectedMime: 'application/vnd.ms-excel',
          expectedExt: 'xls',
        },
        {
          filename: 'course.md',
          buffer: Buffer.from('# Deep Learning 101\n\n- Transformers\n- Attention'),
          expectedMime: 'text/markdown',
          expectedExt: 'md',
        },
        {
          filename: 'roster.csv',
          buffer: Buffer.from('id,name,score\n1,Alice,98\n2,Bob,91'),
          expectedMime: 'text/csv',
          expectedExt: 'csv',
        },
        {
          filename: 'readme.txt',
          buffer: Buffer.from('Plain text syllabus and reading instructions.'),
          expectedMime: 'text/plain',
          expectedExt: 'txt',
        },
      ];

      for (const sample of samples) {
        const res = await http()
          .post(`/documents/spaces/${spaceId}/validate-file`)
          .set('Authorization', token)
          .attach('file', sample.buffer, sample.filename);

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          valid: true,
          mimeType: sample.expectedMime,
          extension: sample.expectedExt,
          size: sample.buffer.length,
        });
      }
    });

    it('rejects spoofed ZIP archive masquerading as .docx without word/document.xml and non-Office OLE2 binary', async () => {
      const token = await bearer(managerId);

      const spoofedZip = Buffer.concat([zipHeader, Buffer.from('word/malicious.exe')]);
      const zipRes = await http()
        .post(`/documents/spaces/${spaceId}/validate-file`)
        .set('Authorization', token)
        .attach('file', spoofedZip, 'spoofed.docx');
      expect(zipRes.status).toBe(400);

      const spoofedMsi = Buffer.concat([ole2Header, Buffer.from('Windows Installer Package')]);
      const msiRes = await http()
        .post(`/documents/spaces/${spaceId}/validate-file`)
        .set('Authorization', token)
        .attach('file', spoofedMsi, 'spoofed.doc');
      expect(msiRes.status).toBe(400);
    });
  });

  describe('POST /documents/spaces/:spaceId/upload and format-aware processing pipelines', () => {
    it('uploads Word, PowerPoint, Excel, and Markdown documents, routes each to its format-specific pipeline step, and supports type filtering and replacement', async () => {
      const token = await bearer(managerId);

      const uploads = [
        {
          title: `${tag} Word Syllabus`,
          filename: 'syllabus.docx',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from(`[Content_Types].xml...word/document.xml...${stamp}`),
          ]),
          expectedMime:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          expectedStepPrefix: 'office_extraction',
          filterType: 'word',
        },
        {
          title: `${tag} Lecture Slides`,
          filename: 'lecture.pptx',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from(`[Content_Types].xml...ppt/presentation.xml...${stamp}`),
          ]),
          expectedMime:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          expectedStepPrefix: 'slide_extraction',
          filterType: 'presentation',
        },
        {
          title: `${tag} Gradebook`,
          filename: 'grades.xlsx',
          buffer: Buffer.concat([
            zipHeader,
            Buffer.from(`[Content_Types].xml...xl/workbook.xml...${stamp}`),
          ]),
          expectedMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          expectedStepPrefix: 'tabular_extraction',
          filterType: 'spreadsheet',
        },
        {
          title: `${tag} Study Guide`,
          filename: 'guide.md',
          buffer: Buffer.from(`# Study Guide ${stamp}\n\nKey definitions and formulas.`),
          expectedMime: 'text/markdown',
          expectedStepPrefix: 'text_chunking',
          filterType: 'text',
        },
      ];

      const createdIds: Record<string, string> = {};

      for (const item of uploads) {
        const res = await http()
          .post(`/documents/spaces/${spaceId}/upload`)
          .set('Authorization', token)
          .field('title', item.title)
          .field('tags', 'enterprise,multiformat')
          .attach('file', item.buffer, item.filename);

        expect(res.status).toBe(201);
        expect(res.body.title).toBe(item.title);
        expect(res.body.currentVersion).toMatchObject({
          versionNo: 1,
          mimeType: item.expectedMime,
          status: 'pending',
        });

        createdIds[item.filterType] = res.body.id;
        if (res.body.currentVersion?.storageKey) {
          storageKeys.push(res.body.currentVersion.storageKey);
        }

        // Wait briefly for setImmediate queue dispatch
        await new Promise((resolve) => setTimeout(resolve, 40));

        const statusRes = await http()
          .get(`/documents/${res.body.id}/status`)
          .set('Authorization', token);
        expect(statusRes.status).toBe(200);
        expect(statusRes.body.steps).toHaveLength(1);
        expect(statusRes.body.steps[0].step).toMatch(
          new RegExp(`^${item.expectedStepPrefix}(_queued)?$`),
        );

        // Verify type filter on GET /documents
        const listRes = await http()
          .get('/documents')
          .query({ spaceId, type: item.filterType })
          .set('Authorization', token);
        expect(listRes.status).toBe(200);
        expect(listRes.body.data.map((d: { id: string }) => d.id)).toContain(res.body.id);
      }

      // Replace the Markdown document (v1) with a Word .docx version (v2) and verify step changes to office_extraction
      const mdDocId = createdIds.text;
      const replacementDocx = Buffer.concat([
        zipHeader,
        Buffer.from(`[Content_Types].xml...word/document.xml...v2-${stamp}`),
      ]);

      const replaceRes = await http()
        .post(`/documents/${mdDocId}/replace`)
        .set('Authorization', token)
        .attach('file', replacementDocx, 'guide-v2.docx');

      expect(replaceRes.status).toBe(201);
      expect(replaceRes.body.currentVersion).toMatchObject({
        versionNo: 2,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        status: 'pending',
      });
      if (replaceRes.body.currentVersion?.storageKey) {
        storageKeys.push(replaceRes.body.currentVersion.storageKey);
      }

      await new Promise((resolve) => setTimeout(resolve, 40));

      const replacedStatus = await http()
        .get(`/documents/${mdDocId}/status`)
        .set('Authorization', token);
      expect(replacedStatus.status).toBe(200);
      expect(replacedStatus.body.currentVersion.versionNo).toBe(2);
      expect(replacedStatus.body.steps[0].step).toMatch(/^office_extraction(_queued)?$/);
    });

    it('rejects upload metadata > 191 chars or > 10 tags with 400 (no MySQL P2000) and caps long default filenames', async () => {
      const token = await bearer(managerId);
      const long192 = 'x'.repeat(192);
      const elevenTags = Array.from({ length: 11 }, (_, i) => `tag${i}`).join(',');
      const txt = Buffer.from(`Bounds test content ${stamp}`);

      for (const [field, value] of [
        ['title', long192],
        ['author', long192],
        ['tags', long192],
        ['tags', elevenTags],
      ] as const) {
        const bad = await http()
          .post(`/documents/spaces/${spaceId}/upload`)
          .set('Authorization', token)
          .field(field, value)
          .attach('file', txt, 'bounds.txt');
        expect(bad.status).toBe(400);
      }

      const longNameRes = await http()
        .post(`/documents/spaces/${spaceId}/upload`)
        .set('Authorization', token)
        .attach('file', Buffer.from(`Long filename ${stamp}`), `${'n'.repeat(210)}.txt`);
      expect(longNameRes.status).toBe(201);
      expect(longNameRes.body.title).toHaveLength(191);
      if (longNameRes.body.currentVersion?.storageKey) {
        storageKeys.push(longNameRes.body.currentVersion.storageKey);
      }
    });
  });
});
