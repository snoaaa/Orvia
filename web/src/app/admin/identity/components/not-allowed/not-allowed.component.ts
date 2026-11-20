import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';

@Component({
  selector: 'app-not-allowed',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent],
  template: `
    <div class="row justify-content-center mt-4">
      <div class="col-md-8 col-lg-6">
        <app-card cardTitle="Access Not Allowed">
          <div class="py-4 text-center">
            <div
              class="d-inline-flex align-items-center justify-content-center rounded-circle bg-light-danger text-danger mb-3"
              style="width: 56px; height: 56px"
            >
              <i class="ti ti-lock-access" style="font-size: 26px"></i>
            </div>
            <h4 class="mb-2">You do not have permission to view this page</h4>
            <p class="text-muted mb-4">
              Your current account permissions do not grant access to
              @if (blockedUrl) {
                <code>{{ blockedUrl }}</code>
              } @else {
                <span>this section of the portal</span>
              }
              .
            </p>
            <a [routerLink]="[session.defaultLandingUrl()]" class="btn btn-primary">
              Return to {{ session.defaultLandingUrl().includes('spaces') ? 'Spaces' : 'Dashboard' }}
            </a>
          </div>
        </app-card>
      </div>
    </div>
  `
})
export class NotAllowedComponent {
  readonly session = inject(PortalSessionService);
  private readonly route = inject(ActivatedRoute, { optional: true });

  get blockedUrl(): string | null {
    return this.route?.snapshot?.queryParamMap?.get('blocked') ?? null;
  }
}
