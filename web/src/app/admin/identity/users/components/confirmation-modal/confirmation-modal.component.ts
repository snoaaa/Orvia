import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Component({
  selector: 'app-confirmation-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOpen) {
      <div class="modal-backdrop fade show"></div>
      <div
        class="modal fade show d-block"
        tabindex="-1"
        role="dialog"
        (click)="onBackdropClick($event)"
      >
        <div class="modal-dialog modal-dialog-centered" role="document">
          <div class="modal-content shadow-lg border-0 rounded-3">
            <div class="modal-body p-4 text-center">
              <!-- Visual Icon Header -->
              <div
                class="modal-icon-badge mx-auto mb-3"
                [ngClass]="getBadgeClass()"
              >
                <i class="ti f-24" [ngClass]="getIconClass()"></i>
              </div>

              <h5 class="modal-title mb-2 f-w-600">{{ title }}</h5>
              <p class="text-muted mb-3">{{ message }}</p>

              @if (detailText) {
                <div class="callout-box bg-light border rounded p-2 mb-3 text-start">
                  <div class="text-muted text-xs text-uppercase f-w-600 mb-1">Target</div>
                  <div class="text-dark text-sm font-monospace text-truncate">{{ detailText }}</div>
                </div>
              }

              <div class="d-flex align-items-center justify-content-end gap-2 pt-2 border-top mt-3">
                <button
                  type="button"
                  class="btn btn-light-secondary px-3"
                  [disabled]="isLoading"
                  (click)="onCancel()"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn d-inline-flex align-items-center gap-1 px-3"
                  [ngClass]="confirmButtonClass"
                  [disabled]="isLoading"
                  (click)="onConfirm()"
                >
                  @if (isLoading) {
                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                    <span>Processing...</span>
                  } @else {
                    <span>{{ confirmText }}</span>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop {
      background-color: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(2px);
      transition: opacity 0.2s ease;
    }

    .modal-dialog {
      animation: modalDialogEnter 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes modalDialogEnter {
      from {
        opacity: 0;
        transform: scale(0.95) translateY(-10px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .modal-icon-badge {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .callout-box {
      border-color: #f0f0f0 !important;
    }

    .text-xs {
      font-size: 0.75rem;
    }
  `]
})
export class ConfirmationModalComponent {
  @Input() isOpen = false;
  @Input() title = 'Confirm Action';
  @Input() message = 'Are you sure you want to proceed?';
  @Input() detailText?: string;
  @Input() confirmText = 'Confirm';
  @Input() confirmButtonClass = 'btn-danger';
  @Input() isLoading = false;
  @Input() icon?: string;

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  getBadgeClass(): string {
    if (this.confirmButtonClass.includes('danger')) return 'bg-light-danger text-danger';
    if (this.confirmButtonClass.includes('success')) return 'bg-light-success text-success';
    return 'bg-light-primary text-primary';
  }

  getIconClass(): string {
    if (this.icon) return this.icon;
    if (this.confirmButtonClass.includes('danger')) return 'ti-alert-triangle';
    if (this.confirmButtonClass.includes('success')) return 'ti-circle-check';
    return 'ti-info-circle';
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.isOpen && !this.isLoading) {
      this.onCancel();
    }
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('modal') && !this.isLoading) {
      this.onCancel();
    }
  }

  onConfirm() {
    if (!this.isLoading) {
      this.confirmed.emit();
    }
  }

  onCancel() {
    if (!this.isLoading) {
      this.cancelled.emit();
    }
  }
}
