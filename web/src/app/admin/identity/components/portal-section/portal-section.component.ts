import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';

@Component({
  selector: 'app-portal-section',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent],
  template: `
    <div class="row">
      <div class="col-12">
        <app-card [cardTitle]="sectionTitle">
          <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3 pb-3 border-bottom">
            <div>
              <span class="text-muted text-sm d-block">{{ sectionDescription }}</span>
              @if (session.activeSchoolName()) {
                <span class="badge bg-light-primary border border-primary mt-1">
                  Scope: {{ session.activeSchoolName() }}
                </span>
              }
            </div>

            <div class="d-flex align-items-center gap-2">
              @if (sectionId === 'schools' && session.hasPermission('schools:create')) {
                <button type="button" id="btn-create-school" class="btn btn-sm btn-primary">
                  <i class="ti ti-plus me-1"></i>Create School
                </button>
              }
              @if (sectionId === 'schools' && session.hasPermission('schools:delete')) {
                <button type="button" id="btn-delete-school" class="btn btn-sm btn-light-danger">
                  <i class="ti ti-trash me-1"></i>Delete School
                </button>
              }
              @if (sectionId === 'spaces' && session.hasPermission('documents:manage')) {
                <button type="button" id="btn-create-space" class="btn btn-sm btn-primary">
                  <i class="ti ti-plus me-1"></i>New Space
                </button>
              }
              @if (sectionId === 'documents' && session.hasPermission('documents:manage')) {
                <a
                  id="btn-upload-document"
                  class="btn btn-sm btn-primary"
                  routerLink="/admin/documents/upload"
                >
                  <i class="ti ti-upload me-1"></i>Upload Document
                </a>
              }
            </div>
          </div>

          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead>
                <tr>
                  <th>NAME</th>
                  @if (session.showSchoolColumn()) {
                    <th class="school-column">SCHOOL</th>
                  }
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td [attr.colspan]="session.showSchoolColumn() ? 3 : 2" class="text-center py-4 text-muted">
                    Showing {{ sectionTitle | lowercase }} for
                    <strong>{{ session.activeSchoolName() || 'your scope' }}</strong>.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </app-card>
      </div>
    </div>
  `
})
export class PortalSectionComponent {
  readonly session = inject(PortalSessionService);
  private readonly route = inject(ActivatedRoute, { optional: true });

  get sectionId(): string {
    return (this.route?.snapshot?.data?.['sectionId'] as string) || 'spaces';
  }

  get sectionTitle(): string {
    return (this.route?.snapshot?.data?.['title'] as string) || 'Spaces';
  }

  get sectionDescription(): string {
    return (
      (this.route?.snapshot?.data?.['description'] as string) ||
      'Manage spaces and documents within your authorized school scope.'
    );
  }
}
