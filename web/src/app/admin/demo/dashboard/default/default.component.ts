import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconDirective, IconService } from '@ant-design/icons-angular';
import {
  FallOutline,
  GiftOutline,
  MessageOutline,
  RiseOutline,
  SettingOutline
} from '@ant-design/icons-angular/icons';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { AnalyticsChartComponent } from 'src/app/admin/theme/shared/apexchart/analytics-chart/analytics-chart.component';
import { IncomeOverviewChartComponent } from 'src/app/admin/theme/shared/apexchart/income-overview-chart/income-overview-chart.component';
import { MonthlyBarChartComponent } from 'src/app/admin/theme/shared/apexchart/monthly-bar-chart/monthly-bar-chart.component';
import { SalesReportChartComponent } from 'src/app/admin/theme/shared/apexchart/sales-report-chart/sales-report-chart.component';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';
import { environment } from 'src/environments/environment';

export interface OverviewResponse {
  range: string;
  scope: 'platform' | 'school';
  generatedAt: string;
  users?: {
    total: number;
    active: number;
    invited: number;
    suspended: number;
  };
  schools?: {
    total: number;
    active: number;
    deactivated: number;
  };
  sessions?: {
    active: number;
  };
  documents?: {
    total: number;
    spaces: number;
    processingErrors?: number;
    processingJobs: Record<string, number>;
  };
  spaces?: Array<{
    id: string;
    name: string;
    documents: number;
  }>;
  recent?: Array<{
    seq: number;
    category: string;
    action: string;
    actorRole: string | null;
    entityType: string | null;
    schoolId: string | null;
    schoolName?: string | null;
    at: string;
  }>;
  alerts?: Array<{
    code: string;
    title: string;
    count: number;
    severity: 'danger' | 'warning' | 'primary';
    subtitle: string;
  }>;
}

export interface DashboardStatCard {
  id: string;
  title: string;
  amount: string;
  background: string;
  border: string;
  icon: string;
  percentage: string;
  color: string;
  notePrefix: string;
  noteHighlight: string;
  noteSuffix: string;
}

export interface DashboardActivityRow {
  time: string;
  event: string;
  outcome: string;
  outcomeType: string;
  actorRole: string;
  school: string;
}

export interface DashboardAlertItem {
  background: string;
  icon: string;
  title: string;
  time: string;
  amount: string;
  percentage: string;
}

/**
 * Role-adapted admin dashboard (§4.5 Tableau de bord, Issue #93).
 *
 * Fetches `GET /admin/overview` scoped to the caller:
 *  - Platform admin: global figures across all schools (Schools, Users, Spaces & Documents, Processing & Alerts) + school breakdown column.
 *  - School admin: figures for their school only (Users, Spaces, Documents, Processing Errors & Sessions), with the school breakdown hidden.
 */
@Component({
  selector: 'app-default',
  imports: [
    CommonModule,
    CardComponent,
    IconDirective,
    MonthlyBarChartComponent,
    IncomeOverviewChartComponent,
    AnalyticsChartComponent,
    SalesReportChartComponent,
    RouterLink
  ],
  templateUrl: './default.component.html',
  styleUrls: ['./default.component.scss']
})
export class DefaultComponent implements OnInit {
  private readonly iconService = inject(IconService);
  private readonly http = inject(HttpClient);
  readonly session = inject(PortalSessionService);

  readonly overview = signal<OverviewResponse | null>(null);
  readonly loading = signal<boolean>(false);

  /**
   * True when viewing global platform figures; false for a school administrator (#93).
   */
  readonly showSchoolBreakdown = computed<boolean>(() => {
    const data = this.overview();
    if (data) {
      return data.scope === 'platform';
    }
    return this.session.isPlatformAdmin();
  });

  readonly dashboardStats = computed<DashboardStatCard[]>(() => {
    const data = this.overview();
    const isPlatform = this.showSchoolBreakdown();

    const totalUsers = data?.users?.total ?? 0;
    const activeUsers = data?.users?.active ?? 0;
    const invitedUsers = data?.users?.invited ?? 0;
    const userActivePct = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;

    const totalSchools = data?.schools?.total ?? 0;
    const activeSchools = data?.schools?.active ?? 0;
    const deactivatedSchools = data?.schools?.deactivated ?? 0;

    const totalDocs = data?.documents?.total ?? 0;
    const totalSpaces = data?.documents?.spaces ?? 0;
    const jobs = data?.documents?.processingJobs ?? {};
    const processingErrors =
      data?.documents?.processingErrors ?? (jobs['failed'] ?? 0) + (jobs['error'] ?? 0);
    const pendingJobs = (jobs['pending'] ?? 0) + (jobs['ocr'] ?? 0) + (jobs['indexing'] ?? 0);
    const activeSessions = data?.sessions?.active ?? 0;

    const usersCard: DashboardStatCard = {
      id: 'users',
      title: 'Users',
      amount: totalUsers.toLocaleString(),
      background: 'bg-light-primary ',
      border: 'border-primary',
      icon: 'rise',
      percentage: `${userActivePct}% active`,
      color: 'text-primary',
      notePrefix: `${activeUsers} active,`,
      noteHighlight: `${invitedUsers} invited`,
      noteSuffix: 'awaiting setup'
    };

    const schoolsCard: DashboardStatCard = {
      id: 'schools',
      title: 'Schools',
      amount: totalSchools.toLocaleString(),
      background: 'bg-light-primary ',
      border: 'border-primary',
      icon: 'rise',
      percentage: `${activeSchools} active`,
      color: 'text-primary',
      notePrefix: `${activeSchools} active ·`,
      noteHighlight: `${deactivatedSchools} deactivated`,
      noteSuffix: ''
    };

    const spacesCard: DashboardStatCard = {
      id: 'spaces',
      title: 'Spaces',
      amount: totalSpaces.toLocaleString(),
      background: 'bg-light-primary ',
      border: 'border-primary',
      icon: 'rise',
      percentage: isPlatform ? 'All schools' : (this.session.activeSchoolName() ?? 'Your school'),
      color: 'text-primary',
      notePrefix: `${totalDocs.toLocaleString()} documents across`,
      noteHighlight: `${totalSpaces} spaces`,
      noteSuffix: ''
    };

    const documentsCard: DashboardStatCard = {
      id: 'documents',
      title: 'Documents',
      amount: totalDocs.toLocaleString(),
      background: processingErrors > 0 ? 'bg-light-danger ' : 'bg-light-warning ',
      border: processingErrors > 0 ? 'border-danger' : 'border-warning',
      icon: processingErrors > 0 ? 'fall' : 'rise',
      percentage: `${totalSpaces} spaces`,
      color: processingErrors > 0 ? 'text-danger' : 'text-warning',
      notePrefix: `${pendingJobs} processing ·`,
      noteHighlight: `${processingErrors} errors`,
      noteSuffix: ''
    };

    const errorsAndSessionsCard: DashboardStatCard = {
      id: 'processing-errors',
      title: 'Processing errors',
      amount: processingErrors.toLocaleString(),
      background: processingErrors > 0 ? 'bg-light-danger ' : 'bg-light-warning ',
      border: processingErrors > 0 ? 'border-danger' : 'border-warning',
      icon: processingErrors > 0 ? 'fall' : 'rise',
      percentage: `${activeSessions} active sessions`,
      color: processingErrors > 0 ? 'text-danger' : 'text-warning',
      notePrefix: `${pendingJobs} pending jobs ·`,
      noteHighlight: `${activeSessions} sessions`,
      noteSuffix: 'online'
    };

    if (isPlatform) {
      return [schoolsCard, usersCard, documentsCard, errorsAndSessionsCard];
    }

    // School Admin: hide the Schools breakdown card; show school-scoped Users, Spaces, Documents, Processing Errors
    return [usersCard, spacesCard, documentsCard, errorsAndSessionsCard];
  });

  readonly recentActivity = computed<DashboardActivityRow[]>(() => {
    const recent = this.overview()?.recent;
    if (!recent || recent.length === 0) {
      return [];
    }

    return recent.map((item) => {
      const { label, outcome, outcomeType } = formatAuditAction(item.action);
      const date = new Date(item.at);
      const time = Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

      return {
        time,
        event: label,
        outcome,
        outcomeType,
        actorRole: item.actorRole || '—',
        school: item.schoolName || item.schoolId || 'Platform'
      };
    });
  });

  readonly securityEvents = computed<DashboardAlertItem[]>(() => {
    const alerts = this.overview()?.alerts;
    if (alerts && alerts.length > 0) {
      return alerts.map((a) => ({
        background:
          a.severity === 'danger'
            ? 'text-danger bg-light-danger'
            : a.severity === 'warning'
              ? 'text-warning bg-light-warning'
              : 'text-primary bg-light-primary',
        icon: a.severity === 'danger' ? 'fall' : a.severity === 'warning' ? 'setting' : 'message',
        title: a.title,
        time: a.subtitle,
        amount: a.count.toString(),
        percentage: a.count === 1 ? '1 alert' : `${a.count} alerts`
      }));
    }

    const isPlatform = this.showSchoolBreakdown();
    const scopeLabel = isPlatform ? 'All schools' : (this.session.activeSchoolName() ?? 'Your school');
    return [
      {
        background: 'text-danger bg-light-danger',
        icon: 'fall',
        title: 'Failed logins',
        time: `${scopeLabel} · last 24h`,
        amount: '0',
        percentage: '0 alerts'
      },
      {
        background: 'text-warning bg-light-warning',
        icon: 'setting',
        title: 'Accounts locked',
        time: `15 min lockout · ${scopeLabel}`,
        amount: '0',
        percentage: '0 alerts'
      },
      {
        background: 'text-primary bg-light-primary',
        icon: 'message',
        title: 'Access denied',
        time: `Blocked requests · ${scopeLabel}`,
        amount: '0',
        percentage: '0 alerts'
      }
    ];
  });

  constructor() {
    this.iconService.addIcon(...[RiseOutline, FallOutline, SettingOutline, GiftOutline, MessageOutline]);
  }

  ngOnInit(): void {
    this.loadOverview();
  }

  loadOverview(): void {
    this.loading.set(true);
    this.http.get<OverviewResponse>(`${environment.apiUrl}/admin/overview?range=7d`).subscribe({
      next: (data) => {
        this.overview.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }
}

function formatAuditAction(action: string): {
  label: string;
  outcome: string;
  outcomeType: string;
} {
  switch (action) {
    case 'login_success':
      return { label: 'Login succeeded', outcome: 'Success', outcomeType: 'bg-success' };
    case 'login_failure':
      return { label: 'Login failed', outcome: 'Failed', outcomeType: 'bg-danger' };
    case 'account_locked':
      return { label: 'Account locked', outcome: 'Failed', outcomeType: 'bg-danger' };
    case 'access_denied':
      return { label: 'Access denied', outcome: 'Failed', outcomeType: 'bg-danger' };
    case 'session_revoked':
      return { label: 'Session revoked', outcome: 'Warning', outcomeType: 'bg-warning' };
    case 'user_suspended':
      return { label: 'User suspended', outcome: 'Warning', outcomeType: 'bg-warning' };
    case 'user_reactivated':
      return { label: 'User reactivated', outcome: 'Success', outcomeType: 'bg-success' };
    case 'user_invited':
      return { label: 'User invited', outcome: 'Success', outcomeType: 'bg-success' };
    case 'role_assigned':
      return { label: 'Role assigned', outcome: 'Success', outcomeType: 'bg-success' };
    case 'password_setup':
      return { label: 'First password set', outcome: 'Success', outcomeType: 'bg-success' };
    default:
      return {
        label: action.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
        outcome: 'Success',
        outcomeType: 'bg-success'
      };
  }
}
