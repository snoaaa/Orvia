// angular import
import { HttpClient } from '@angular/common/http';
import { Component, inject, input, output } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

// project import
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { SharedModule } from 'src/app/admin/theme/shared/shared.module';
import { environment } from 'src/environments/environment';

// icon
import { IconService } from '@ant-design/icons-angular';
import {
  ArrowRightOutline,
  BellOutline,
  CheckCircleOutline,
  CommentOutline,
  EditOutline,
  GiftOutline,
  LockOutline,
  LogoutOutline,
  MessageOutline,
  PhoneOutline,
  ProfileOutline,
  QuestionCircleOutline,
  SettingOutline,
  UnorderedListOutline,
  UserOutline,
  WalletOutline
} from '@ant-design/icons-angular/icons';

@Component({
  selector: 'app-nav-right',
  imports: [SharedModule, RouterModule],
  templateUrl: './nav-right.component.html',
  styleUrls: ['./nav-right.component.scss']
})
export class NavRightComponent {
  private readonly iconService = inject(IconService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly session = inject(PortalSessionService);

  // public props
  styleSelectorToggle = input<boolean>();
  readonly Customize = output();
  windowWidth: number;
  screenFull: boolean = true;
  direction: string = 'ltr';

  // constructor
  constructor() {
    this.windowWidth = window.innerWidth;
    this.iconService.addIcon(
      ...[
        CheckCircleOutline,
        GiftOutline,
        MessageOutline,
        SettingOutline,
        PhoneOutline,
        LogoutOutline,
        EditOutline,
        UserOutline,
        ProfileOutline,
        QuestionCircleOutline,
        LockOutline,
        CommentOutline,
        UnorderedListOutline,
        ArrowRightOutline,
        BellOutline,
        WalletOutline
      ]
    );
  }

  profile = [
    {
      icon: 'user',
      title: 'View Profile',
      action: 'profile'
    },
    {
      icon: 'logout',
      title: 'Logout',
      action: 'logout'
    }
  ];

  setting = [
    {
      icon: 'question-circle',
      title: 'Support'
    },
    {
      icon: 'lock',
      title: 'Privacy Center'
    }
  ];

  onSchoolChange(schoolId: string): void {
    this.session.selectSchool(schoolId || null);
  }

  onProfileTaskClick(action?: string): void {
    if (action === 'logout') {
      this.logout();
    }
  }

  logout(): void {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (token) {
      this.http
        .post(
          `${environment.apiUrl}/auth/logout`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        )
        .subscribe({ error: () => {} });
    }
    this.session.clearSession();
    void this.router.navigateByUrl('/admin/login');
  }
}
