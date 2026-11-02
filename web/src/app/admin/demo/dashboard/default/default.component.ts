// angular import
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

// project import
import { MonthlyBarChartComponent } from 'src/app/admin/theme/shared/apexchart/monthly-bar-chart/monthly-bar-chart.component';
import { IncomeOverviewChartComponent } from 'src/app/admin/theme/shared/apexchart/income-overview-chart/income-overview-chart.component';
import { AnalyticsChartComponent } from 'src/app/admin/theme/shared/apexchart/analytics-chart/analytics-chart.component';
import { SalesReportChartComponent } from 'src/app/admin/theme/shared/apexchart/sales-report-chart/sales-report-chart.component';

// icons
import { IconService, IconDirective } from '@ant-design/icons-angular';
import { FallOutline, GiftOutline, MessageOutline, RiseOutline, SettingOutline } from '@ant-design/icons-angular/icons';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';

/**
 * Admin dashboard.
 *
 * The figures below are placeholder values that describe the WAMDP domain (users,
 * schools, sessions, documents, audit activity) instead of the template's e-commerce
 * demo data. They are plain frontend data today; the shape matches what the planned
 * `GET /admin/overview` endpoint will return, so wiring it later only replaces the
 * arrays with the response.
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
export class DefaultComponent {
  private iconService = inject(IconService);

  // constructor
  constructor() {
    this.iconService.addIcon(...[RiseOutline, FallOutline, SettingOutline, GiftOutline, MessageOutline]);
  }

  /** KPI row. `notePrefix` / `noteHighlight` / `noteSuffix` build the muted footer line. */
  dashboardStats = [
    {
      title: 'Users',
      amount: '248',
      background: 'bg-light-primary ',
      border: 'border-primary',
      icon: 'rise',
      percentage: '75% active',
      color: 'text-primary',
      notePrefix: '186 active,',
      noteHighlight: '18 invited',
      noteSuffix: 'awaiting setup'
    },
    {
      title: 'Schools',
      amount: '12',
      background: 'bg-light-primary ',
      border: 'border-primary',
      icon: 'rise',
      percentage: '11 active',
      color: 'text-primary',
      notePrefix: '11 active ·',
      noteHighlight: '1 deactivated',
      noteSuffix: ''
    },
    {
      title: 'Active sessions',
      amount: '37',
      background: 'bg-light-warning ',
      border: 'border-warning',
      icon: 'rise',
      percentage: '9 schools',
      color: 'text-warning',
      notePrefix: 'across',
      noteHighlight: '9 schools',
      noteSuffix: 'right now'
    },
    {
      title: 'Documents',
      amount: '1,842',
      background: 'bg-light-warning ',
      border: 'border-warning',
      icon: 'rise',
      percentage: '94% processed',
      color: 'text-warning',
      notePrefix: 'of which',
      noteHighlight: '61 processing',
      noteSuffix: '· 49 failed'
    }
  ];

  /** Latest entries of the audit trail (newest first). */
  recentActivity = [
    {
      time: '20:41',
      event: 'Login succeeded',
      outcome: 'Success',
      outcomeType: 'bg-success',
      actorRole: 'PLATFORM_ADMIN',
      school: 'WAMDP Platform'
    },
    {
      time: '20:38',
      event: 'Role assigned',
      outcome: 'Success',
      outcomeType: 'bg-success',
      actorRole: 'SCHOOL_ADMIN',
      school: 'Lycée Ibn Sina'
    },
    {
      time: '20:12',
      event: 'Login failed',
      outcome: 'Failed',
      outcomeType: 'bg-danger',
      actorRole: '—',
      school: 'Collège Al Massira'
    },
    {
      time: '19:57',
      event: 'Session revoked',
      outcome: 'Warning',
      outcomeType: 'bg-warning',
      actorRole: 'SCHOOL_ADMIN',
      school: 'Collège Al Massira'
    },
    {
      time: '19:40',
      event: 'User invited',
      outcome: 'Success',
      outcomeType: 'bg-success',
      actorRole: 'SCHOOL_ADMIN',
      school: 'Lycée Ibn Sina'
    },
    {
      time: '18:05',
      event: 'Access denied',
      outcome: 'Failed',
      outcomeType: 'bg-danger',
      actorRole: 'CONTENT_MANAGER',
      school: 'Lycée Ibn Sina'
    },
    {
      time: '17:22',
      event: 'Account locked',
      outcome: 'Failed',
      outcomeType: 'bg-danger',
      actorRole: '—',
      school: 'Collège Al Massira'
    }
  ];

  /** Security signals of the last hour, shown in the "Security events" list. */
  securityEvents = [
    {
      background: 'text-danger bg-light-danger',
      icon: 'fall',
      title: 'Failed logins',
      time: 'admin@gmail.com · last hour',
      amount: '5',
      percentage: 'this hour'
    },
    {
      background: 'text-warning bg-light-warning',
      icon: 'setting',
      title: 'Accounts locked',
      time: 'user@lycee.edu · 19:40',
      amount: '1',
      percentage: '15 min lock'
    },
    {
      background: 'text-primary bg-light-primary',
      icon: 'message',
      title: 'Access denied',
      time: 'content@college.edu · 18:05',
      amount: '3',
      percentage: 'this hour'
    }
  ];
}
