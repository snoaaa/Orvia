import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { AnalyticsChartComponent } from 'src/app/admin/theme/shared/apexchart/analytics-chart/analytics-chart.component';
import { IncomeOverviewChartComponent } from 'src/app/admin/theme/shared/apexchart/income-overview-chart/income-overview-chart.component';
import { MonthlyBarChartComponent } from 'src/app/admin/theme/shared/apexchart/monthly-bar-chart/monthly-bar-chart.component';
import { SalesReportChartComponent } from 'src/app/admin/theme/shared/apexchart/sales-report-chart/sales-report-chart.component';
import { environment } from 'src/environments/environment';
import { DefaultComponent, OverviewResponse } from './default.component';

describe('DefaultComponent (Issue #93 — Role-Adapted Dashboard)', () => {
  let component: DefaultComponent;
  let fixture: ComponentFixture<DefaultComponent>;
  let httpMock: HttpTestingController;
  let session: PortalSessionService;

  const platformOverview: OverviewResponse = {
    range: '7d',
    scope: 'platform',
    generatedAt: '2026-11-20T01:00:00.000Z',
    users: { total: 248, active: 186, invited: 18, suspended: 44 },
    schools: { total: 12, active: 11, deactivated: 1 },
    sessions: { active: 37 },
    documents: {
      total: 1842,
      spaces: 15,
      processingErrors: 4,
      processingJobs: { pending: 6, completed: 1832, failed: 4 }
    },
    recent: [
      {
        seq: 1,
        category: 'authentication',
        action: 'login_success',
        actorRole: 'PLATFORM_ADMIN',
        entityType: 'user',
        schoolId: null,
        schoolName: 'Platform',
        at: '2026-11-20T01:00:00.000Z'
      }
    ],
    alerts: [
      {
        code: 'failed_logins',
        title: 'Failed logins',
        count: 5,
        severity: 'danger',
        subtitle: 'All schools · last 24h'
      },
      {
        code: 'processing_errors',
        title: 'Processing errors',
        count: 4,
        severity: 'danger',
        subtitle: 'Document pipeline · all schools'
      }
    ]
  };

  const schoolOverview: OverviewResponse = {
    range: '7d',
    scope: 'school',
    generatedAt: '2026-11-20T01:00:00.000Z',
    users: { total: 32, active: 28, invited: 4, suspended: 0 },
    schools: { total: 1, active: 1, deactivated: 0 },
    sessions: { active: 8 },
    documents: {
      total: 120,
      spaces: 3,
      processingErrors: 1,
      processingJobs: { pending: 2, completed: 117, failed: 1 }
    },
    recent: [
      {
        seq: 2,
        category: 'identity_access',
        action: 'user_invited',
        actorRole: 'SCHOOL_ADMIN',
        entityType: 'user',
        schoolId: 'school-a',
        schoolName: 'Demo School A',
        at: '2026-11-20T01:15:00.000Z'
      }
    ],
    alerts: [
      {
        code: 'failed_logins',
        title: 'Failed logins',
        count: 1,
        severity: 'danger',
        subtitle: 'Your school · last 24h'
      },
      {
        code: 'processing_errors',
        title: 'Processing errors',
        count: 1,
        severity: 'danger',
        subtitle: 'Document pipeline · your school'
      }
    ]
  };

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [DefaultComponent],
      providers: [
        PortalSessionService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([])
      ]
    })
      .overrideComponent(DefaultComponent, {
        remove: {
          imports: [
            MonthlyBarChartComponent,
            IncomeOverviewChartComponent,
            AnalyticsChartComponent,
            SalesReportChartComponent
          ]
        },
        add: {
          schemas: [NO_ERRORS_SCHEMA]
        }
      })
      .compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    session = TestBed.inject(PortalSessionService);

    fixture = TestBed.createComponent(DefaultComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('shows global figures and the school breakdown for a Platform Admin', () => {
    fixture.detectChanges();

    const req = httpMock.expectOne(`${environment.apiUrl}/admin/overview?range=7d`);
    expect(req.request.method).toBe('GET');
    req.flush(platformOverview);
    fixture.detectChanges();

    expect(component.showSchoolBreakdown()).toBe(true);
    const statIds = component.dashboardStats().map((s) => s.id);
    expect(statIds).toEqual(['schools', 'users', 'documents', 'processing-errors']);
    expect(component.dashboardStats()[0].amount).toBe('12');
    expect(component.dashboardStats()[1].amount).toBe('248');

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.school-breakdown-col').length).toBeGreaterThan(0);
    expect(el.textContent).toContain('Platform Overview — All Schools');
  });

  it('shows school-scoped figures and hides the school breakdown for a School Admin', () => {
    session.setUser({
      id: 'sa-1',
      email: 'school.admin@demo.test',
      fullName: 'School A Admin',
      status: 'ACTIVE',
      role: 'SCHOOL_ADMIN',
      permissions: ['users:read', 'metrics:view', 'documents:manage'],
      schoolIds: ['school-a'],
      schools: [{ id: 'school-a', name: 'Demo School A' }],
      isPlatformAdmin: false,
      assignments: []
    });

    fixture.detectChanges();

    const req = httpMock.expectOne(`${environment.apiUrl}/admin/overview?range=7d`);
    req.flush(schoolOverview);
    fixture.detectChanges();

    expect(component.showSchoolBreakdown()).toBe(false);
    const statIds = component.dashboardStats().map((s) => s.id);
    // Schools breakdown card is hidden for School Admin; Spaces card is shown instead
    expect(statIds).toEqual(['users', 'spaces', 'documents', 'processing-errors']);
    expect(component.dashboardStats()[0].amount).toBe('32');
    expect(component.dashboardStats()[1].amount).toBe('3');
    expect(component.dashboardStats()[2].amount).toBe('120');
    expect(component.dashboardStats()[3].amount).toBe('1');

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.school-breakdown-col').length).toBe(0);
    expect(el.textContent).toContain('School Overview — Demo School A');
  });
});
