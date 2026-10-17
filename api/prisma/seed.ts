import { PrismaClient, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export const BASE_ROLES = [
  { name: 'PLATFORM_ADMIN', scope: 'platform' },
  { name: 'SCHOOL_ADMIN', scope: 'school' },
  { name: 'CONTENT_MANAGER', scope: 'school' },
  { name: 'STAFF', scope: 'school' },
  { name: 'STUDENT', scope: 'group' },
  { name: 'PARENT_GUEST', scope: 'group' },
] as const;

export const BASE_PERMISSIONS = [
  // Platform & Administration
  { code: 'system:manage', description: 'Full system administration and configuration' },
  { code: 'audit:read', description: 'View audit logs and trail events' },
  { code: 'audit:export', description: 'Export tamper-evident audit records' },
  { code: 'metrics:view', description: 'View system-wide RAG performance and telemetry metrics' },

  // Schools & Multi-tenancy
  { code: 'schools:create', description: 'Create and register new educational institutions' },
  { code: 'schools:read', description: 'View institution profiles and configurations' },
  { code: 'schools:update', description: 'Update institution details and allowed domains' },
  { code: 'schools:delete', description: 'Deactivate or delete institutions' },

  // Users & Membership
  { code: 'users:invite', description: 'Send invitations to new users' },
  { code: 'users:create', description: 'Create user accounts manually' },
  { code: 'users:read', description: 'View user profile information' },
  { code: 'users:update', description: 'Update user profiles, email, and status' },
  { code: 'users:suspend', description: 'Suspend or reactivate user accounts' },
  { code: 'users:assign_role', description: 'Assign roles and scopes to users' },

  // Academic Groups & Classes
  { code: 'groups:create', description: 'Create student cohorts, classes, and research groups' },
  { code: 'groups:read', description: 'View group details and roster' },
  { code: 'groups:update', description: 'Edit group details and settings' },
  { code: 'groups:delete', description: 'Archive or remove groups' },
  { code: 'groups:manage_members', description: 'Add or remove members from groups' },

  // Spaces & Document Repositories
  { code: 'spaces:create', description: 'Create academic knowledge spaces' },
  { code: 'spaces:read', description: 'Browse and view knowledge spaces' },
  { code: 'spaces:update', description: 'Modify space settings and access rules' },
  { code: 'spaces:delete', description: 'Delete or archive knowledge spaces' },

  // Documents & Processing
  { code: 'documents:create', description: 'Upload and register new documents' },
  { code: 'documents:read', description: 'Read and download document content' },
  { code: 'documents:update', description: 'Edit document metadata, tags, and titles' },
  { code: 'documents:delete', description: 'Soft-delete or purge documents' },
  { code: 'documents:publish', description: 'Publish documents to broader audiences' },
  { code: 'documents:manage_access', description: 'Configure granular document access rights' },
  { code: 'documents:process', description: 'Trigger OCR, chunking, and embedding pipelines' },

  // Conversations & RAG
  { code: 'conversations:create', description: 'Start new RAG query conversations' },
  { code: 'conversations:read', description: 'View own conversation history and messages' },
  { code: 'conversations:update', description: 'Rename or edit conversation sessions' },
  { code: 'conversations:delete', description: 'Delete or archive conversations' },
  { code: 'messages:send', description: 'Submit questions and messages to RAG assistant' },
  { code: 'rag:query', description: 'Perform retrieval-augmented generation search' },
  { code: 'answers:save', description: 'Bookmark and save high-value answers' },
  { code: 'answers:report', description: 'Report inaccurate or harmful RAG responses' },

  // Mobile & Synchronization
  { code: 'devices:register', description: 'Register mobile client devices for synchronization' },
  { code: 'devices:manage', description: 'View and revoke registered mobile devices' },
  { code: 'sync:execute', description: 'Perform delta sync between mobile and cloud' },
  { code: 'offline:select', description: 'Mark documents and spaces for offline caching' },
] as const;

export const ROLE_PERMISSIONS_MATRIX: Record<string, string[]> = {
  PLATFORM_ADMIN: BASE_PERMISSIONS.map((p) => p.code),
  SCHOOL_ADMIN: [
    'schools:read',
    'schools:update',
    'users:invite',
    'users:create',
    'users:read',
    'users:update',
    'users:suspend',
    'users:assign_role',
    'groups:create',
    'groups:read',
    'groups:update',
    'groups:delete',
    'groups:manage_members',
    'spaces:create',
    'spaces:read',
    'spaces:update',
    'spaces:delete',
    'documents:create',
    'documents:read',
    'documents:update',
    'documents:delete',
    'documents:publish',
    'documents:manage_access',
    'documents:process',
    'conversations:create',
    'conversations:read',
    'conversations:update',
    'conversations:delete',
    'messages:send',
    'rag:query',
    'answers:save',
    'answers:report',
    'devices:register',
    'devices:manage',
    'sync:execute',
    'offline:select',
    'audit:read',
  ],
  CONTENT_MANAGER: [
    'spaces:read',
    'spaces:update',
    'documents:create',
    'documents:read',
    'documents:update',
    'documents:delete',
    'documents:publish',
    'documents:process',
    'conversations:create',
    'conversations:read',
    'messages:send',
    'rag:query',
    'answers:save',
    'devices:register',
    'sync:execute',
    'offline:select',
  ],
  STAFF: [
    'spaces:read',
    'documents:create',
    'documents:read',
    'documents:update',
    'conversations:create',
    'conversations:read',
    'conversations:update',
    'conversations:delete',
    'messages:send',
    'rag:query',
    'answers:save',
    'answers:report',
    'devices:register',
    'devices:manage',
    'sync:execute',
    'offline:select',
  ],
  STUDENT: [
    'spaces:read',
    'documents:read',
    'conversations:create',
    'conversations:read',
    'conversations:update',
    'conversations:delete',
    'messages:send',
    'rag:query',
    'answers:save',
    'answers:report',
    'devices:register',
    'sync:execute',
    'offline:select',
  ],
  PARENT_GUEST: [
    'spaces:read',
    'documents:read',
    'conversations:create',
    'conversations:read',
    'messages:send',
    'rag:query',
  ],
};

async function main(): Promise<void> {
  console.log('--- Starting Database Seeding ---');

  // 1. Seed Roles
  const rolesByName = new Map<string, string>();
  for (const roleDef of BASE_ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: { scope: roleDef.scope },
      create: {
        name: roleDef.name,
        scope: roleDef.scope,
      },
    });
    rolesByName.set(role.name, role.id);
  }
  console.log(`✓ Seeded ${rolesByName.size} roles.`);

  // 2. Seed Permissions
  const permissionsByCode = new Map<string, string>();
  for (const permDef of BASE_PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { code: permDef.code },
      update: { description: permDef.description },
      create: {
        code: permDef.code,
        description: permDef.description,
      },
    });
    permissionsByCode.set(perm.code, perm.id);
  }
  console.log(`✓ Seeded ${permissionsByCode.size} permissions.`);

  // 3. Link Role-Permissions
  let linkCount = 0;
  for (const [roleName, permissionCodes] of Object.entries(ROLE_PERMISSIONS_MATRIX)) {
    const roleId = rolesByName.get(roleName);
    if (!roleId) continue;

    for (const code of permissionCodes) {
      const permissionId = permissionsByCode.get(code);
      if (!permissionId) continue;

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId,
          permissionId,
        },
      });
      linkCount++;
    }
  }
  console.log(`✓ Linked ${linkCount} role-permission mappings.`);

  // 4. Ensure System School exists for platform-level scoping
  const systemSchool = await prisma.school.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {
      name: 'WAMDP Platform Administration',
      allowedDomains: 'wamdp.platform,platform.internal',
      status: 'active',
    },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'WAMDP Platform Administration',
      allowedDomains: 'wamdp.platform,platform.internal',
      status: 'active',
      settings: { isSystemTenant: true },
      domains: {
        create: [
          { domain: 'wamdp.platform' },
          { domain: 'platform.internal' },
        ],
      },
    },
  });
  console.log(`✓ Ensured platform system school (${systemSchool.id}).`);

  // 5. Seed First Platform Administrator
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim() || 'admin@wamdp.platform';
  const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD?.trim() || process.env.ADMIN_PASSWORD?.trim() || 'wamdp_admin_2026!';
  const adminName = process.env.PLATFORM_ADMIN_NAME?.trim() || process.env.ADMIN_NAME?.trim() || 'Platform Administrator';

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      fullName: adminName,
      status: UserStatus.ACTIVE,
      passwordHash,
    },
    create: {
      email: adminEmail,
      fullName: adminName,
      authProvider: 'local',
      passwordHash,
      status: UserStatus.ACTIVE,
    },
  });
  console.log(`✓ Seeded platform administrator user (${adminUser.email}).`);

  // 6. Assign PLATFORM_ADMIN role to First Administrator
  const platformAdminRoleId = rolesByName.get('PLATFORM_ADMIN');
  if (platformAdminRoleId) {
    const existingAssignment = await prisma.userAssignment.findFirst({
      where: {
        userId: adminUser.id,
        roleId: platformAdminRoleId,
      },
    });

    if (!existingAssignment) {
      await prisma.userAssignment.create({
        data: {
          userId: adminUser.id,
          roleId: platformAdminRoleId,
          schoolId: systemSchool.id,
        },
      });
      console.log(`✓ Assigned PLATFORM_ADMIN role to ${adminUser.email}.`);
    } else {
      console.log(`✓ PLATFORM_ADMIN role assignment verified for ${adminUser.email}.`);
    }
  }

  console.log('--- Database Seeding Completed Successfully ---');
}

main()
  .catch((e) => {
    console.error('Database seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
